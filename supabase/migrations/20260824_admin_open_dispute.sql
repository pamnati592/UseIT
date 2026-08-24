-- Lets an admin open a dispute themselves, from a support conversation,
-- for a user who contacted UseIT without going through the normal
-- "Report a Problem" flow in ChatRoomScreen. Mirrors report_issue exactly
-- (same transaction/dispute-row shape, same one-open-case-per-transaction
-- dedup), except: admin-gated instead of party-gated, and the reporter is
-- named explicitly (p_user_id) since the admin isn't the reporter — the
-- thread they're standing in tells the caller which party that is.
create or replace function public.admin_open_dispute(
  p_transaction_id uuid,
  p_user_id uuid,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tx public.transactions;
  dispute_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select * into tx from public.transactions where id = p_transaction_id;
  if not found then raise exception 'transaction not found'; end if;
  if p_user_id <> tx.renter_id and p_user_id <> tx.lender_id then
    raise exception 'user is not a party to this transaction';
  end if;
  if tx.status not in ('paid', 'active', 'disputed') then
    raise exception 'transaction is not open for dispute (status: %)', tx.status;
  end if;

  update public.transactions set status = 'disputed' where id = p_transaction_id;

  insert into public.disputes (transaction_id, reporter_id, description)
  values (p_transaction_id, p_user_id, coalesce(p_description, 'Opened by UseIT from a support conversation'))
  on conflict (transaction_id) where status = 'open' do nothing
  returning id into dispute_id;

  if dispute_id is null then
    select id into dispute_id
    from public.disputes
    where transaction_id = p_transaction_id and status = 'open';
  end if;

  return dispute_id;
end;
$function$;
