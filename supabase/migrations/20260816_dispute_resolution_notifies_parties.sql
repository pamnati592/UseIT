-- admin_resolve_dispute updated the DB but never told either party what was
-- decided — no message, no Badge Jump, no explanation on the Deal Board
-- card (it just showed the same generic "cancelled"/"completed" text as any
-- other rental). Both parties now get a real notification.
--
-- Deliberately does NOT mark either party's last_read_at — every other
-- system message in this app is inserted by one of the two participants
-- and marks *their own* read status (see insertSystemMessage in
-- ChatRoomScreen / src/services/chatMessages.ts). Here neither party acted;
-- the admin did, and the admin isn't a conversation participant with a read
-- field at all. Leaving both renter_last_read_at and lender_last_read_at
-- untouched means both sides genuinely see this as new — Badge Jump fires
-- for both, not just whoever happens to open the chat next.
create or replace function public.admin_resolve_dispute(p_transaction_id uuid, p_favor text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tx public.transactions;
  v_content text;
  v_preview text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_favor not in ('renter', 'lender') then raise exception 'p_favor must be renter or lender'; end if;

  select * into tx from public.transactions where id = p_transaction_id;
  if not found then raise exception 'transaction not found'; end if;
  if tx.status <> 'disputed' then raise exception 'transaction is not disputed'; end if;

  update public.disputes
  set status = 'resolved', resolution = 'favor_' || p_favor || coalesce(': ' || p_note, ''), resolved_at = now()
  where transaction_id = p_transaction_id and status = 'open';

  if p_favor = 'renter' then
    update public.transactions set status = 'cancelled' where id = p_transaction_id;
    v_content := '⚖️ UseIT reviewed this dispute and ruled in favor of the renter.'
      || coalesce(' ' || p_note, '') || ' A refund is being processed.';
    v_preview := '⚖️ Dispute resolved · Favor renter';
  else
    update public.transactions set status = 'completed' where id = p_transaction_id;
    v_content := '⚖️ UseIT reviewed this dispute and ruled in favor of the lender.'
      || coalesce(' ' || p_note, '');
    v_preview := '⚖️ Dispute resolved · Favor lender';
  end if;

  update public.conversations
  set last_message = v_preview, last_message_at = now()
  where id = tx.conversation_id;

  insert into public.messages (conversation_id, sender_id, content, transaction_id)
  values (tx.conversation_id, auth.uid(), v_content, p_transaction_id);
end;
$function$;
