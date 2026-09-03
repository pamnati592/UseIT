-- Backfill: seven migrations were applied directly to the live project between
-- 2026-08-09 and 2026-08-12 without ever being committed as files here. Found
-- while tracing the QR handoff's condition-photo save (confirm_condition's
-- 3-arg overload) back to a migration that didn't exist in this repo.
--
-- This one file captures the net current state of all seven, verified against
-- the live database (table/column/policy/function introspection), rather than
-- guessing at intermediate versions of functions later replaced anyway. The
-- originally-applied names/timestamps, for traceability against Supabase's own
-- migration history:
--   20260809101843  add_transactions_purchases_to_realtime
--   20260809141657  submit_rating_reject_duplicate
--   20260811131139  handoff_evidence_bucket
--   20260811131152  handoff_photos_and_disputes
--   20260811131212  report_issue_with_evidence   (superseded by the already-
--                                                  tracked 20260813_disputes_one_open_case.sql)
--   20260811142009  decline_at_pickup
--   20260812131754  confirm_condition_records_photo
--
-- Every statement below is written idempotently (IF NOT EXISTS / OR REPLACE /
-- ON CONFLICT DO NOTHING) so it is safe to run against the live project this
-- was reconstructed from as well as a fresh one.

-- ── add_transactions_purchases_to_realtime ──────────────────────────────────
-- ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS, so guard it by hand —
-- adding an already-member relation raises "is already member of publication".
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'purchases'
  ) then
    alter publication supabase_realtime add table public.purchases;
  end if;
end $$;

-- ── submit_rating_reject_duplicate ──────────────────────────────────────────
-- Same shape as the sibling fix for item reviews (20260816_submit_item_review_
-- reject_duplicate.sql): a second rating on the same transaction by the same
-- reviewer is rejected instead of silently double-counting into the score.
create or replace function public.submit_rating(p_tx uuid, p_score integer, p_comment text default null::text)
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
$$;

grant execute on function public.submit_rating(uuid, integer, text) to authenticated;

-- ── handoff_photos_and_disputes ─────────────────────────────────────────────
-- The disputes table report_issue (tracked in 20260813_disputes_one_open_case.sql)
-- inserts into but that no file here ever created.
create table if not exists public.disputes (
  id            uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id),
  reporter_id   uuid not null references auth.users(id),
  description   text,
  photo_url     text,
  status        text not null default 'open',
  resolution    text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

create index if not exists disputes_transaction_id_idx on public.disputes (transaction_id);
create index if not exists disputes_status_idx on public.disputes (status);

alter table public.disputes enable row level security;

drop policy if exists "disputes: parties read" on public.disputes;
create policy "disputes: parties read"
  on public.disputes for select
  using (
    exists (
      select 1 from public.transactions t
      where t.id = disputes.transaction_id
        and (t.renter_id = auth.uid() or t.lender_id = auth.uid())
    )
  );

-- ── handoff_evidence_bucket ──────────────────────────────────────────────────
-- Pickup/return condition photos (QRScanScreen) and dispute evidence photos
-- (ChatRoomScreen) both land here, scoped per-transaction like verification-photos
-- is scoped per-uploader.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('handoff-evidence', 'handoff-evidence', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

drop policy if exists "handoff evidence: parties upload" on storage.objects;
create policy "handoff evidence: parties upload"
  on storage.objects for insert
  with check (
    bucket_id = 'handoff-evidence'
    and exists (
      select 1 from public.transactions t
      where t.id::text = (storage.foldername(objects.name))[1]
        and (t.renter_id = auth.uid() or t.lender_id = auth.uid())
    )
  );

drop policy if exists "handoff evidence: parties read" on storage.objects;
create policy "handoff evidence: parties read"
  on storage.objects for select
  using (
    bucket_id = 'handoff-evidence'
    and exists (
      select 1 from public.transactions t
      where t.id::text = (storage.foldername(objects.name))[1]
        and (t.renter_id = auth.uid() or t.lender_id = auth.uid())
    )
  );

-- ── confirm_condition_records_photo ─────────────────────────────────────────
-- Adds the photo columns and the 3-arg confirm_condition overload that
-- QRScanScreen.tsx actually calls (the 2-arg version from
-- 20260606_qr_handoff_rpcs.sql is left in place — PostgREST resolves the RPC
-- call by which argument names the caller supplies).
alter table public.transactions
  add column if not exists pickup_photo_url text,
  add column if not exists return_photo_url text;

create or replace function public.confirm_condition(p_tx uuid, p_phase text, p_photo_url text default null::text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tx public.transactions;
  uid uuid := auth.uid();
begin
  select * into tx from public.transactions where id = p_tx;
  if not found then raise exception 'transaction not found'; end if;
  if uid <> tx.renter_id and uid <> tx.lender_id then
    raise exception 'not a party to this transaction';
  end if;
  if p_phase not in ('pickup', 'return') then
    raise exception 'invalid phase';
  end if;

  if p_phase = 'pickup' then
    if uid = tx.renter_id then
      update public.transactions set pickup_renter_ok = true where id = p_tx;
    else
      update public.transactions set pickup_lender_ok = true where id = p_tx;
    end if;
    if p_photo_url is not null then
      update public.transactions set pickup_photo_url = p_photo_url where id = p_tx;
    end if;
  else
    if uid = tx.renter_id then
      update public.transactions set return_renter_ok = true where id = p_tx;
    else
      update public.transactions set return_lender_ok = true where id = p_tx;
    end if;
    if p_photo_url is not null then
      update public.transactions set return_photo_url = p_photo_url where id = p_tx;
    end if;
  end if;
end;
$$;

grant execute on function public.confirm_condition(uuid, text, text) to authenticated;

-- ── decline_at_pickup ────────────────────────────────────────────────────────
-- The renter's "item isn't as described — don't take it" action on QRScanScreen's
-- pickup checklist step. Cancels the rental and logs a pre-resolved dispute row
-- (not an open case) so repeated declines against one lender are visible later.
create or replace function public.decline_at_pickup(p_tx uuid, p_reason text default null::text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tx  public.transactions;
  uid uuid := auth.uid();
begin
  select * into tx from public.transactions where id = p_tx;
  if not found then raise exception 'transaction not found'; end if;
  if uid <> tx.renter_id then
    raise exception 'only the renter can decline the item at pickup';
  end if;
  if tx.status <> 'paid' then
    raise exception 'this rental is not awaiting pickup';
  end if;

  update public.transactions set status = 'cancelled' where id = p_tx;

  insert into public.disputes (transaction_id, reporter_id, description, status)
  values (p_tx, uid, coalesce(p_reason, 'Renter declined the item at pickup'), 'resolved');
end;
$$;

grant execute on function public.decline_at_pickup(uuid, text) to authenticated;
