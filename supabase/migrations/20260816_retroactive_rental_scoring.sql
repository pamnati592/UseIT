-- Backlog N: reputation score bootstrap. Previously lender_score/renter_score
-- were a plain average of received star ratings — this replaces that with a
-- weighted-recency blend of ratings plus behavioral signals (response time,
-- on-time return, disputes, cancellation rate), matching the factors the
-- backlog specified. "Item condition accuracy" was in the original wishlist
-- but there is no structured field capturing that today (ratings only have a
-- single 1-5 score + free-text comment) — deliberately folded into the
-- overall rating rather than invented from nothing; a real fix would add a
-- dedicated question to the rating flow first.

alter table public.profiles add column if not exists lender_cancellations integer not null default 0;

-- Half-life ~180 days: exp(-k * days) = 0.5 at days=180 => k = ln(2)/180.
-- Applied identically to the rating average and the behavioral average so a
-- transaction from a year ago barely moves either component.
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
  where r.reviewee_id = p_lender_id;

  -- Behavioral score (0-5): response time to requests (approved_at - created_at,
  -- full credit within 24h, none past 72h) blended with an inverse cancellation
  -- flag, each transaction weighted by the same recency decay as the ratings.
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

  -- Ratings are the primary signal once they exist (organic renter feedback);
  -- behavior alone stands in before the first rating arrives.
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
  where r.reviewee_id = p_renter_id;

  -- Behavioral score (0-5): on-time return (returned_at vs end_date, 4h grace,
  -- full penalty past 48h late), no dispute on the transaction, and not
  -- cancelled — each weighted equally, same recency decay as the ratings.
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

-- submit_rating now triggers the full weighted recompute instead of a plain
-- avg(score) — "run on every rating insert, so scores stay live without a
-- separate cron job" per the backlog.
create or replace function public.submit_rating(p_tx uuid, p_score integer, p_comment text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tx       public.transactions;
  uid      uuid := auth.uid();
  reviewee uuid;
begin
  select * into tx from public.transactions where id = p_tx;
  if not found then raise exception 'transaction not found'; end if;
  if uid <> tx.renter_id and uid <> tx.lender_id then
    raise exception 'not a party to this transaction';
  end if;
  if tx.status <> 'completed' then
    raise exception 'rental is not completed yet';
  end if;
  if p_score < 1 or p_score > 5 then
    raise exception 'score must be between 1 and 5';
  end if;
  if exists (select 1 from public.ratings where transaction_id = p_tx and reviewer_id = uid) then
    raise exception 'you have already rated this rental';
  end if;

  reviewee := case when uid = tx.renter_id then tx.lender_id else tx.renter_id end;

  insert into public.ratings (transaction_id, reviewer_id, reviewee_id, score, comment)
  values (p_tx, uid, reviewee, p_score, p_comment);

  if reviewee = tx.lender_id then
    perform public.recompute_lender_score(reviewee);
  else
    perform public.recompute_renter_score(reviewee);
  end if;
end;
$function$;

-- Tracks lender-initiated cancellations specifically (not the renter's
-- decline_at_pickup, which also flips status to 'cancelled' but is called by
-- the renter — auth.uid() inside this trigger reflects the actual caller
-- regardless of any SECURITY DEFINER function in between, so this only
-- fires when the lender themselves performed the update).
create or replace function public.track_lender_cancellation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.status = 'cancelled' and OLD.status <> 'cancelled' and auth.uid() = NEW.lender_id then
    update public.profiles set lender_cancellations = lender_cancellations + 1 where id = NEW.lender_id;
    perform public.recompute_lender_score(NEW.lender_id);
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_track_lender_cancellation on public.transactions;
create trigger trg_track_lender_cancellation
after update of status on public.transactions
for each row
execute function public.track_lender_cancellation();

-- Retroactive bootstrap: recompute every profile with rental history now,
-- so existing scores reflect the new formula immediately rather than only
-- drifting to it as new ratings trickle in.
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
