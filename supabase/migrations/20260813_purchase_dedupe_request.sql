-- Buy could be tapped repeatedly on the same item, creating a new pending
-- purchase row every time with no way to tell them apart in the Deal Board.
-- create_purchase is now idempotent per (item, buyer): if an active request
-- already exists, hand back that same purchase/conversation instead of
-- creating a duplicate — the client already just navigates to the Deal Board
-- with whatever id it gets back, so this requires no client change.
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
  v_existing        public.purchases;
begin
  if v_buyer_id is null then
    raise exception 'Not authenticated';
  end if;

  select owner_id, sale_price, title into v_seller_id, v_price, v_item_title
  from public.items where id = p_item_id;

  if v_seller_id is null then raise exception 'Item not found'; end if;
  if v_price is null then raise exception 'This item is not for sale'; end if;
  if v_buyer_id = v_seller_id then raise exception 'You cannot buy your own item'; end if;

  select * into v_existing
  from public.purchases
  where item_id = p_item_id and buyer_id = v_buyer_id and status in ('pending', 'approved')
  limit 1;

  if found then
    return json_build_object('conversation_id', v_existing.conversation_id, 'purchase_id', v_existing.id);
  end if;

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
