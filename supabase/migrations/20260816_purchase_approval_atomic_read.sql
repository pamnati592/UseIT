-- approve_purchase/reject_purchase bumped conversations.last_message_at, then the
-- client made a *separate* call to mark the caller's own last_read_at. That gap
-- was a real race: any badge listener (including the caller's own device) could
-- see "unread" for the caller's own action before it self-corrected a moment
-- later. Setting lender_last_read_at in the same UPDATE as last_message_at closes
-- the window entirely. Safe to assume the caller is always lender_id here: both
-- RPCs already require auth.uid() = seller_id, and create_purchase always stores
-- the seller as conversations.lender_id.
create or replace function public.approve_purchase(p_purchase uuid)
returns void
language plpgsql
security definer
as $function$
declare
  p public.purchases;
  v_conflict record;
begin
  select * into p from public.purchases where id = p_purchase;
  if not found then raise exception 'purchase not found'; end if;
  if auth.uid() <> p.seller_id then raise exception 'only the seller can approve'; end if;
  if p.status <> 'pending' then raise exception 'purchase is not pending'; end if;

  select t.start_date, t.end_date into v_conflict
  from public.transactions t
  where t.item_id = p.item_id
    and t.status in ('approved', 'paid', 'active')
    and t.end_date > now()
  order by t.start_date
  limit 1;

  if found then
    raise exception 'Cannot approve — this item is already committed to a rental from % to %. Resolve that rental before selling the item.',
      to_char(v_conflict.start_date, 'DD Mon'), to_char(v_conflict.end_date, 'DD Mon');
  end if;

  update public.purchases set status = 'approved' where id = p_purchase;

  update public.conversations
  set last_message = '✅ Approved · Ready for pickup', last_message_at = now(), lender_last_read_at = now()
  where id = p.conversation_id;
end;
$function$;

create or replace function public.reject_purchase(p_purchase uuid)
returns void
language plpgsql
security definer
as $function$
declare
  p public.purchases;
begin
  select * into p from public.purchases where id = p_purchase;
  if not found then raise exception 'purchase not found'; end if;
  if auth.uid() <> p.seller_id then raise exception 'only the seller can decline'; end if;
  if p.status <> 'pending' then raise exception 'purchase is not pending'; end if;

  update public.purchases set status = 'rejected' where id = p_purchase;

  update public.conversations
  set last_message = '❌ Purchase request declined', last_message_at = now(), lender_last_read_at = now()
  where id = p.conversation_id;
end;
$function$;
