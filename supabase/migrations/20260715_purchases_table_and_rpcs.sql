-- Buy flow: a purchase is a single-stage deal (unlike the multi-step rental
-- flow) — no approval step (the seller already committed to the sale price
-- when listing), payment happens in person at pickup (not remotely on tap),
-- kept in its own table since the rental state machine (approve/pay/pickup
-- QR/return QR) doesn't apply here at all.

create type public.purchase_status as enum ('pending', 'paid', 'cancelled');

create table public.purchases (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.items(id) on delete cascade,
  buyer_id        uuid not null references public.profiles(id) on delete cascade,
  seller_id       uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  price           numeric not null,
  status          purchase_status not null default 'pending',
  stripe_payment_intent_id text,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz
);

alter table public.purchases enable row level security;

create policy purchases_select_participants
  on public.purchases for select
  using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- Buyer taps "Buy": find-or-create the conversation, insert a pending purchase,
-- and a plain chat message so the seller gets notified (not a deal-board card —
-- the purchase row itself is the card, fetched directly by the client).
create or replace function public.create_purchase(p_item_id uuid)
returns json
language plpgsql
security definer
as $$
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
  insert into public.messages (conversation_id, sender_id, content)
  values (v_conversation_id, v_buyer_id, v_message);

  update public.conversations
  set last_message = v_message, last_message_at = now()
  where id = v_conversation_id;

  return json_build_object('conversation_id', v_conversation_id, 'purchase_id', v_purchase_id);
end;
$$;

-- Buyer confirms they physically have the item and pays (called after the
-- Stripe payment sheet succeeds, mirroring handlePay for rentals). Also
-- cancels any other still-pending purchase requests for the same item, since
-- it's now sold.
create or replace function public.mark_purchase_paid(p_purchase uuid)
returns void
language plpgsql
security definer
as $$
declare
  p public.purchases;
begin
  select * into p from public.purchases where id = p_purchase;
  if not found then raise exception 'purchase not found'; end if;
  if auth.uid() <> p.buyer_id then raise exception 'only the buyer can pay'; end if;
  if p.status <> 'pending' then raise exception 'purchase is not pending'; end if;

  update public.purchases set status = 'paid', paid_at = now() where id = p_purchase;

  update public.purchases
  set status = 'cancelled'
  where item_id = p.item_id and status = 'pending' and id <> p_purchase;

  -- Sold — stop showing it in the feed. Not surfaced publicly as "sold";
  -- only visible to the seller (via their own item list / history).
  update public.items set is_hidden = true where id = p.item_id;
end;
$$;

-- Either party can cancel a still-pending purchase (e.g. buyer changed their
-- mind, or seller already sold it to someone else in person).
create or replace function public.cancel_purchase(p_purchase uuid)
returns void
language plpgsql
security definer
as $$
declare
  p public.purchases;
begin
  select * into p from public.purchases where id = p_purchase;
  if not found then raise exception 'purchase not found'; end if;
  if auth.uid() <> p.buyer_id and auth.uid() <> p.seller_id then
    raise exception 'not a party to this purchase';
  end if;
  if p.status <> 'pending' then raise exception 'purchase is not pending'; end if;

  update public.purchases set status = 'cancelled' where id = p_purchase;
end;
$$;

grant execute on function public.create_purchase(uuid)      to authenticated;
grant execute on function public.mark_purchase_paid(uuid)   to authenticated;
grant execute on function public.cancel_purchase(uuid)      to authenticated;
