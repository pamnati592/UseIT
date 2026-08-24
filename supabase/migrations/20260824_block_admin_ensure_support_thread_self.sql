-- Same rule as ensure_support_thread (20260823_block_admin_support_thread):
-- an admin is UseIT, so a thread can't exist where the "user" side is also
-- an admin — that's just an admin messaging themselves. Reachable in
-- practice here because the sole admin account is also a real test party
-- on real transactions ("Message Renter"/"Message Lender" from the Dispute
-- Queue on a dispute where the admin happens to be the renter or lender).
create or replace function public.admin_ensure_support_thread(p_transaction_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tx public.transactions;
  v_thread_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if exists (select 1 from public.profiles where id = p_user_id and is_admin) then
    raise exception 'cannot open a support thread with another admin';
  end if;

  select * into tx from public.transactions where id = p_transaction_id;
  if not found then raise exception 'transaction not found'; end if;
  if p_user_id <> tx.renter_id and p_user_id <> tx.lender_id then
    raise exception 'user is not a party to this transaction';
  end if;

  select id into v_thread_id from public.support_threads
  where transaction_id = p_transaction_id and user_id = p_user_id;

  if v_thread_id is null then
    insert into public.support_threads (transaction_id, user_id)
    values (p_transaction_id, p_user_id)
    returning id into v_thread_id;
  end if;

  return v_thread_id;
end;
$function$;
