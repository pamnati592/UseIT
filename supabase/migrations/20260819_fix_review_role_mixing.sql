-- Real bug found while building the "reviews by role" screen (requested
-- 2026-08-19): recompute_lender_score and recompute_renter_score both
-- averaged every rating a user ever received (ratings.reviewee_id = user),
-- regardless of which role they were actually rated in for that specific
-- transaction. A rating a lender left about their renter fed into that
-- renter's lender_score just as much as into their renter_score — the two
-- scores were computed from the exact same input set. Confirmed live: Nati's
-- 4 received ratings (5,5 as lender, 5,3 as renter) were being averaged
-- identically into both scores.
--
-- Fix: join to transactions and require the reviewee actually held that role
-- in that transaction. Rerun the retroactive bootstrap so existing scores
-- reflect the correction immediately (same reasoning as the original N
-- migration's bootstrap).
create or replace function public.recompute_lender_score(p_lender_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rating_avg   numeric;
  v_behavior_avg numeric;
  v_final        numeric;
  v_cancellations integer;
begin
  select
    case when sum(exp(-0.00385 * extract(epoch from (now() - r.created_at)) / 86400)) > 0
      then sum(r.score * exp(-0.00385 * extract(epoch from (now() - r.created_at)) / 86400))
           / sum(exp(-0.00385 * extract(epoch from (now() - r.created_at)) / 86400))
      else null
    end
  into v_rating_avg
  from public.ratings r
  join public.transactions t on t.id = r.transaction_id
  where r.reviewee_id = p_lender_id and t.lender_id = p_lender_id;

  select
    case when sum(w) > 0 then
      5 * sum(w * (
        0.5 * coalesce(response_component, 0.5) +
        0.5 * (case when status = 'cancelled' then 0 else 1 end)
      )) / sum(w)
    else null end
  into v_behavior_avg
  from (
    select
      t.status,
      exp(-0.00385 * extract(epoch from (now() - t.created_at)) / 86400) as w,
      case
        when t.approved_at is not null
          then greatest(0, 1 - extract(epoch from (t.approved_at - t.created_at)) / 3600.0 / 72.0)
        else null
      end as response_component
    from public.transactions t
    where t.lender_id = p_lender_id
      and t.status in ('approved', 'paid', 'active', 'completed', 'cancelled')
  ) sub;

  v_final := case
    when v_rating_avg is not null and v_behavior_avg is not null then 0.7 * v_rating_avg + 0.3 * v_behavior_avg
    when v_rating_avg is not null then v_rating_avg
    when v_behavior_avg is not null then v_behavior_avg
    else 0
  end;

  select lender_cancellations into v_cancellations from public.profiles where id = p_lender_id;
  v_final := v_final - least(1.0, 0.1 * coalesce(v_cancellations, 0));

  update public.profiles set lender_score = least(5, greatest(0, v_final)) where id = p_lender_id;
end;
$function$;

create or replace function public.recompute_renter_score(p_renter_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rating_avg   numeric;
  v_behavior_avg numeric;
  v_final        numeric;
begin
  select
    case when sum(exp(-0.00385 * extract(epoch from (now() - r.created_at)) / 86400)) > 0
      then sum(r.score * exp(-0.00385 * extract(epoch from (now() - r.created_at)) / 86400))
           / sum(exp(-0.00385 * extract(epoch from (now() - r.created_at)) / 86400))
      else null
    end
  into v_rating_avg
  from public.ratings r
  join public.transactions t on t.id = r.transaction_id
  where r.reviewee_id = p_renter_id and t.renter_id = p_renter_id;

  select
    case when sum(w) > 0 then
      5 * sum(w * (
        (1.0/3) * (
          case
            when returned_at is not null and returned_at <= end_date + interval '4 hours' then 1
            when returned_at is not null then greatest(0, 1 - extract(epoch from (returned_at - end_date)) / 3600.0 / 48.0)
            else 1
          end
        ) +
        (1.0/3) * (case when has_dispute then 0 else 1 end) +
        (1.0/3) * (case when status = 'cancelled' then 0 else 1 end)
      )) / sum(w)
    else null end
  into v_behavior_avg
  from (
    select
      t.id, t.status, t.end_date, t.returned_at,
      exp(-0.00385 * extract(epoch from (now() - t.created_at)) / 86400) as w,
      exists(select 1 from public.disputes d where d.transaction_id = t.id) as has_dispute
    from public.transactions t
    where t.renter_id = p_renter_id
      and t.status in ('approved', 'paid', 'active', 'completed', 'cancelled')
  ) sub;

  v_final := case
    when v_rating_avg is not null and v_behavior_avg is not null then 0.7 * v_rating_avg + 0.3 * v_behavior_avg
    when v_rating_avg is not null then v_rating_avg
    when v_behavior_avg is not null then v_behavior_avg
    else 0
  end;

  update public.profiles set renter_score = least(5, greatest(0, v_final)) where id = p_renter_id;
end;
$function$;

do $$
declare
  v_id uuid;
begin
  for v_id in select distinct lender_id from public.transactions loop
    perform public.recompute_lender_score(v_id);
  end loop;
  for v_id in select distinct renter_id from public.transactions loop
    perform public.recompute_renter_score(v_id);
  end loop;
end $$;
