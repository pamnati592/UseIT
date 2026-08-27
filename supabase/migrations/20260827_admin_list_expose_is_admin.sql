-- admin_ensure_support_thread already rejects messaging a party who is
-- themselves an admin ("cannot open a support thread with another admin",
-- 20260824_block_admin_ensure_support_thread_self) — but the two screens
-- that call it (AdminOverdueScreen, AdminDisputesScreen) had no way to know
-- that ahead of time, so "Message Renter"/"Message Lender" always rendered
-- and dead-ended in that RPC error whenever the party happened to be an
-- admin. Exposing renter_is_admin/lender_is_admin here lets both screens
-- hide the button instead — the RPC stays the actual enforcement (SAS: the
-- DB is the single source of truth for this rule), this is just the UI
-- catching up to what it already rejects.
drop function if exists public.admin_list_overdue_rentals();
drop function if exists public.admin_list_disputes();

create or replace function public.admin_list_overdue_rentals()
returns table(
  transaction_id uuid, item_title text, start_date timestamptz, end_date timestamptz,
  daily_price numeric, renter_id uuid, renter_name text, renter_is_admin boolean,
  lender_id uuid, lender_name text, lender_is_admin boolean,
  late_days integer, accrued_fee numeric, cliff_charged boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  return query
  select
    t.id,
    i.title,
    t.start_date,
    t.end_date,
    i.daily_price,
    t.renter_id,
    r.full_name,
    r.is_admin,
    t.lender_id,
    l.full_name,
    l.is_admin,
    greatest(0, (current_date - t.end_date::date))::integer as late_days,
    (greatest(0, (current_date - t.end_date::date)) * i.daily_price)::numeric as accrued_fee,
    exists (
      select 1 from public.admin_charges ac
      where ac.transaction_id = t.id and ac.reason = 'late_fee_cliff' and ac.status = 'succeeded'
    ) as cliff_charged
  from public.transactions t
  join public.items i on i.id = t.item_id
  join public.profiles r on r.id = t.renter_id
  join public.profiles l on l.id = t.lender_id
  where t.status = 'active' and t.end_date < now()
  order by late_days desc;
end;
$function$;

create or replace function public.admin_list_disputes()
returns table(
  transaction_id uuid, item_title text, item_photo text, start_date timestamptz, end_date timestamptz,
  total_price numeric, renter_id uuid, renter_name text, renter_is_admin boolean,
  lender_id uuid, lender_name text, lender_is_admin boolean,
  dispute_id uuid, description text, photo_url text, reporter_id uuid, reported_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  return query
  select
    t.id, i.title, i.photos[1], t.start_date, t.end_date, t.total_price,
    t.renter_id, rp.full_name, rp.is_admin,
    t.lender_id, lp.full_name, lp.is_admin,
    d.id, d.description, d.photo_url, d.reporter_id, d.created_at
  from public.transactions t
  join public.items i on i.id = t.item_id
  join public.profiles rp on rp.id = t.renter_id
  join public.profiles lp on lp.id = t.lender_id
  left join public.disputes d on d.transaction_id = t.id and d.status = 'open'
  where t.status = 'disputed'
  order by d.created_at desc nulls last;
end;
$function$;
