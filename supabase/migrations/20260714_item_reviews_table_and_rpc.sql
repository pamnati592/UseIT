-- Post-rental item review: renter rates the item itself (separate axis from the
-- person rating in ratings/submit_rating). One review per (transaction, reviewer).

alter table public.items
  add column avg_rating   numeric,
  add column review_count integer not null default 0;

create table public.item_reviews (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  item_id        uuid not null references public.items(id) on delete cascade,
  reviewer_id    uuid not null references public.profiles(id) on delete cascade,
  score          smallint not null check (score between 1 and 5),
  comment        text,
  created_at     timestamptz not null default now(),
  unique (transaction_id, reviewer_id)
);

alter table public.item_reviews enable row level security;

-- Reviews are readable by any signed-in user (shown on the item's detail screen).
-- Inserts/updates only happen through the submit_item_review RPC below (security
-- definer) — same pattern as ratings/submit_rating.
create policy item_reviews_select_authenticated
  on public.item_reviews for select
  using (auth.role() = 'authenticated');

-- Only the renter reviews the item (they're the one who actually used it).
-- Recomputes the item's avg_rating/review_count rollup after each insert/update.
create or replace function public.submit_item_review(p_tx uuid, p_score int, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tx public.transactions;
begin
  select * into tx from public.transactions where id = p_tx;
  if not found then raise exception 'transaction not found'; end if;
  if auth.uid() <> tx.renter_id then
    raise exception 'only the renter can review the item';
  end if;
  if tx.status <> 'completed' then
    raise exception 'rental is not completed yet';
  end if;
  if p_score < 1 or p_score > 5 then
    raise exception 'score must be between 1 and 5';
  end if;

  insert into public.item_reviews (transaction_id, item_id, reviewer_id, score, comment)
  values (p_tx, tx.item_id, auth.uid(), p_score, p_comment)
  on conflict (transaction_id, reviewer_id) do update
    set score = excluded.score, comment = excluded.comment;

  update public.items set
    avg_rating   = (select avg(score) from public.item_reviews where item_id = tx.item_id),
    review_count = (select count(*)   from public.item_reviews where item_id = tx.item_id)
  where id = tx.item_id;
end;
$$;

grant execute on function public.submit_item_review(uuid, int, text) to authenticated;
