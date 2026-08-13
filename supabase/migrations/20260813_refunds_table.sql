-- Backlog Z step 2: a place to record refunds so the promise in the UI
-- ("you will receive a refund") is backed by an auditable row, not just a
-- Stripe API call nobody can trace back to a transaction later.
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions(id),
  stripe_refund_id text,
  amount numeric not null,
  percentage integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.refunds enable row level security;

create policy "refunds_select_participants" on public.refunds
  for select
  using (
    exists (
      select 1 from public.transactions t
      where t.id = refunds.transaction_id
        and (auth.uid() = t.renter_id or auth.uid() = t.lender_id)
    )
  );
