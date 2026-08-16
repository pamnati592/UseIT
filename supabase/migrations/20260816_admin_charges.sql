-- Shared infrastructure for post-payment charges: damage assessed during
-- dispute resolution, and late-return fees (spec 4.8/4.10 extension, requested
-- 2026-08-16). All three reasons reuse the same off-session Stripe charge
-- primitive (edge functions), this table is just the audit trail — client
-- code never inserts here directly.
create type public.admin_charge_reason as enum ('damage', 'late_fee_daily', 'late_fee_cliff');
create type public.admin_charge_status as enum ('succeeded', 'failed');

create table public.admin_charges (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id),
  reason public.admin_charge_reason not null,
  amount numeric not null check (amount > 0),
  status public.admin_charge_status not null,
  -- null charged_by = automated (the late_fee_daily auto-charge on return scan);
  -- set = a human admin triggered it (damage, or the late_fee_cliff fine).
  charged_by uuid references public.profiles(id),
  stripe_payment_intent_id text,
  note text,
  created_at timestamptz not null default now()
);

alter table public.admin_charges enable row level security;

create policy "admin_charges: party or admin read" on public.admin_charges
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.transactions t
      where t.id = admin_charges.transaction_id
        and (t.renter_id = auth.uid() or t.lender_id = auth.uid())
    )
  );

-- No insert/update policy for authenticated/anon — every row is written by an
-- edge function using the service role after it has actually placed the
-- Stripe charge (or recorded why it couldn't).

-- Admin-only overdue rentals list: active transactions whose return is past
-- due. late_days and accrued_fee are computed live (not yet charged — the
-- per-day fee is only actually charged when the item is finally returned,
-- see charge-late-fee edge function); this view is for visibility and for
-- the manual 2-week-cliff fine, which the admin must set an amount for.
create or replace function public.admin_list_overdue_rentals()
returns table (
  transaction_id uuid,
  item_title text,
  start_date timestamptz,
  end_date timestamptz,
  daily_price numeric,
  renter_id uuid,
  renter_name text,
  lender_id uuid,
  lender_name text,
  late_days integer,
  accrued_fee numeric,
  cliff_charged boolean
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
    t.lender_id,
    l.full_name,
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
