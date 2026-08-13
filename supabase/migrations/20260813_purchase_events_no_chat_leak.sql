-- Purchase lifecycle events (request/approve/reject) were being written into
-- public.messages with transaction_id = null. messages.transaction_id has a
-- hard FK to transactions(id), so it can never point at a purchases row —
-- meaning these rows were indistinguishable from real chat messages and
-- leaked into the plain Chat tab. The Deal Board card doesn't need them: it
-- already has its own realtime subscription directly on public.purchases,
-- and the unread badge is driven by conversations.last_message_at vs. each
-- user's last-read timestamp, not by message row counts. So: keep the
-- conversation preview update, drop the messages insert.

create or replace function public.create_purchase(p_item_id uuid)
returns json
language plpgsql
security definer
as $function$
declare
  v_buyer_id        uuid := auth.uid();
  v_seller_id       uuid;
  v_price           numeric;
  v_item_title      text;
  v_conversation_id uuid;
  v_purchase_id     uuid;
  v_message         text;
begin
  if v_buyer_id is null then
    raise exception 'Not authenticated';
  end if;

  select owner_id, sale_price, title into v_seller_id, v_price, v_item_title
  from public.items where id = p_item_id;

  if v_seller_id is null then raise exception 'Item not found'; end if;
  if v_price is null then raise exception 'This item is not for sale'; end if;
  if v_buyer_id = v_seller_id then raise exception 'You cannot buy your own item'; end if;

  select id into v_conversation_id
  from public.conversations
  where item_id = p_item_id and renter_id = v_buyer_id and lender_id = v_seller_id;

  if v_conversation_id is null then
    insert into public.conversations (item_id, renter_id, lender_id)
    values (p_item_id, v_buyer_id, v_seller_id)
    returning id into v_conversation_id;
  end if;

  insert into public.purchases (item_id, buyer_id, seller_id, conversation_id, price)
  values (p_item_id, v_buyer_id, v_seller_id, v_conversation_id, v_price)
  returning id into v_purchase_id;

  v_message := '🛍️ Wants to buy: ' || v_item_title || ' · ₪' || v_price;

  update public.conversations
  set last_message = v_message, last_message_at = now()
  where id = v_conversation_id;

  return json_build_object('conversation_id', v_conversation_id, 'purchase_id', v_purchase_id);
end;
$function$;

create or replace function public.approve_purchase(p_purchase uuid)
returns void
language plpgsql
security definer
as $function$
declare
  p public.purchases;
begin
  select * into p from public.purchases where id = p_purchase;
  if not found then raise exception 'purchase not found'; end if;
  if auth.uid() <> p.seller_id then raise exception 'only the seller can approve'; end if;
  if p.status <> 'pending' then raise exception 'purchase is not pending'; end if;

  update public.purchases set status = 'approved' where id = p_purchase;

  update public.conversations
  set last_message = '✅ Approved · Ready for pickup', last_message_at = now()
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
  set last_message = '❌ Purchase request declined', last_message_at = now()
  where id = p.conversation_id;
end;
$function$;

-- Clean up the two leaked rows from this session's test purchase.
delete from public.messages
where transaction_id is null
  and content in (
    '✅ Approved: Bosch Power Drill Set · Pay in person when you receive it.',
    '🛍️ Wants to buy: Bosch Power Drill Set · ₪350.00'
  );
