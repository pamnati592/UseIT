-- An admin is UseIT — they must never be able to open a support thread as a
-- party to their own transaction (that would mean messaging themselves).
-- This is the single place a thread ever gets created for the calling user
-- (RLS has no insert policy on support_threads; every write goes through
-- this SECURITY DEFINER function or admin_ensure_support_thread), so
-- enforcing it here is sufficient regardless of which UI ever calls it.
create or replace function public.ensure_support_thread(p_transaction_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tx public.transactions;
  v_thread_id uuid;
begin
  if public.is_admin() then
    raise exception 'admins cannot open a support thread as a party — use the Support Inbox instead';
  end if;

  select * into tx from public.transactions where id = p_transaction_id;
  if not found then raise exception 'transaction not found'; end if;
  if auth.uid() <> tx.renter_id and auth.uid() <> tx.lender_id then
    raise exception 'not a party to this transaction';
  end if;

  select id into v_thread_id from public.support_threads
  where transaction_id = p_transaction_id and user_id = auth.uid();

  if v_thread_id is null then
    insert into public.support_threads (transaction_id, user_id)
    values (p_transaction_id, auth.uid())
    returning id into v_thread_id;
  end if;

  return v_thread_id;
end;
$function$;
