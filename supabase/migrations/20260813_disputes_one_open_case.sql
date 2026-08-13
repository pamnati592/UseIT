-- Backlog X: a client-side in-flight guard is not a constraint.
--
-- On 2026-08-12 a real two-device test produced two dispute rows 0.6s apart for
-- transaction d9d6fea4, each with its own photo upload (byte-identical, 2,716,537
-- bytes), because the Submit button stayed tappable while the photo uploaded.
-- The client guard was fixed in 3c9d301, but a retry, a slow network, or a second
-- device could still open two live cases on one rental. Enforce it in the database.
--
-- Applied to the live project on 2026-08-13. The duplicate row was deleted first
-- (the later of the two, 0a761f3d); the index cannot be created while it exists.

-- Partial: only ONE case may be open at a time. Once a case is resolved, a new
-- issue on the same rental is legitimate and must remain possible — which a plain
-- unique (transaction_id) would wrongly forbid.
create unique index if not exists disputes_one_open_per_transaction
  on public.disputes (transaction_id)
  where status = 'open';

-- Without this, the index above surfaces a raw Postgres unique-violation
-- ("duplicate key value violates unique constraint ...") to the user on the exact
-- retry it was added to stop. Make the RPC idempotent instead: a second report
-- while a case is already open returns the existing case id rather than failing.
--
-- Why return instead of raise: the reporter's intent — "this rental has a problem,
-- look at it" — is already satisfied by the open case. A double-tap or a network
-- retry should be a no-op, not an error the user has to interpret.
--
-- The defaults on p_description / p_photo_url are preserved deliberately. PostgREST
-- resolves the overload by which argument names the caller supplies, and dropping
-- them would change which function a 1-arg call binds to.
create or replace function public.report_issue(
  p_tx uuid,
  p_description text default null::text,
  p_photo_url text default null::text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tx public.transactions;
  uid uuid := auth.uid();
  dispute_id uuid;
begin
  select * into tx from public.transactions where id = p_tx;
  if not found then raise exception 'transaction not found'; end if;
  if uid <> tx.renter_id and uid <> tx.lender_id then
    raise exception 'not a party to this transaction';
  end if;

  update public.transactions set status = 'disputed' where id = p_tx;

  insert into public.disputes (transaction_id, reporter_id, description, photo_url)
  values (p_tx, uid, p_description, p_photo_url)
  on conflict (transaction_id) where status = 'open' do nothing
  returning id into dispute_id;

  -- ON CONFLICT DO NOTHING returns no row, so dispute_id is null when a case was
  -- already open. Hand back the existing one; the caller gets a usable id either way.
  if dispute_id is null then
    select id into dispute_id
    from public.disputes
    where transaction_id = p_tx and status = 'open';
  end if;

  return dispute_id;
end;
$$;
