-- Post-rental rating: table + submit_rating RPC.
-- One rating per (transaction, reviewer) — each party rates the other once per completed rental.

create table public.ratings (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  reviewer_id    uuid not null references public.profiles(id) on delete cascade,
  reviewee_id    uuid not null references public.profiles(id) on delete cascade,
  score          smallint not null check (score between 1 and 5),
  comment        text,
  created_at     timestamptz not null default now(),
  unique (transaction_id, reviewer_id)
);

alter table public.ratings enable row level security;

-- Reviews are readable by any signed-in user (they build public trust, shown on profiles).
-- Inserts/updates only happen through the submit_rating RPC below (security definer),
-- so there is no insert/update policy here — same pattern as the QR handoff RPCs.
create policy ratings_select_authenticated
  on public.ratings for select
  using (auth.role() = 'authenticated');

-- Insert (or update, if the reviewer re-submits) a rating for a completed transaction,
-- then recompute the reviewee's lender_score or renter_score — whichever role they
-- held in this specific transaction.
create or replace function public.submit_rating(p_tx uuid, p_score int, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  reviewee := case when uid = tx.renter_id then tx.lender_id else tx.renter_id end;

  insert into public.ratings (transaction_id, reviewer_id, reviewee_id, score, comment)
  values (p_tx, uid, reviewee, p_score, p_comment)
  on conflict (transaction_id, reviewer_id) do update
    set score = excluded.score, comment = excluded.comment;

  if reviewee = tx.lender_id then
    update public.profiles set lender_score = (
      select coalesce(avg(r.score), 0) from public.ratings r
      join public.transactions t on t.id = r.transaction_id
      where r.reviewee_id = reviewee and t.lender_id = reviewee
    ) where id = reviewee;
  else
    update public.profiles set renter_score = (
      select coalesce(avg(r.score), 0) from public.ratings r
      join public.transactions t on t.id = r.transaction_id
      where r.reviewee_id = reviewee and t.renter_id = reviewee
    ) where id = reviewee;
  end if;
end;
$$;

grant execute on function public.submit_rating(uuid, int, text) to authenticated;
