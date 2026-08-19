-- Real gap found live 2026-08-19: admin_resolve_dispute commits the ruling
-- (transaction -> cancelled/completed, dispute -> resolved) BEFORE the client
-- calls refund-payment/admin-charge for the actual money movement. Those two
-- steps are not atomic. When the Stripe step fails — here because the test
-- transaction had no real payment intent to refund, but in production a
-- transient Stripe/network failure would do the exact same thing —
-- admin_list_disputes only returns transactions with status = 'disputed', so
-- the case silently vanishes from the admin's queue with the ruling already
-- recorded and the renter/lender never actually paid or refunded. Nobody
-- would know without querying the DB directly.
--
-- Fix: a compensating rollback the client calls when the post-ruling Stripe
-- step throws. Reopens the dispute and puts the transaction back to
-- 'disputed' so it reappears in the queue, and corrects the system message
-- both parties already saw ("a refund is being processed") since that claim
-- is no longer true.
create or replace function public.admin_reopen_dispute(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tx public.transactions;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select * into tx from public.transactions where id = p_transaction_id;
  if not found then raise exception 'transaction not found'; end if;

  update public.disputes
  set status = 'open', resolution = null, resolved_at = null
  where transaction_id = p_transaction_id and status = 'resolved';

  update public.transactions set status = 'disputed' where id = p_transaction_id;

  update public.conversations
  set last_message = '⚠️ Dispute resolution could not be completed', last_message_at = now()
  where id = tx.conversation_id;

  insert into public.messages (conversation_id, sender_id, content, transaction_id)
  values (
    tx.conversation_id,
    auth.uid(),
    '⚠️ The previous ruling on this dispute could not be completed due to a payment issue — it has been reopened and is still under review by UseIT.',
    p_transaction_id
  );
end;
$function$;
