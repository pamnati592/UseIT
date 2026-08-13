-- Seller must approve/decline a purchase request before the buyer can pay,
-- mirroring the rental request flow. New enum values ('approved','rejected')
-- were added in a prior migration so they're safe to use here.

create or replace function public.approve_purchase(p_purchase uuid)
returns void
language plpgsql
security definer
as $function$
declare
  p public.purchases;
  v_item_title text;
begin
  select * into p from public.purchases where id = p_purchase;
  if not found then raise exception 'purchase not found'; end if;
  if auth.uid() <> p.seller_id then raise exception 'only the seller can approve'; end if;
  if p.status <> 'pending' then raise exception 'purchase is not pending'; end if;

  update public.purchases set status = 'approved' where id = p_purchase;

  select title into v_item_title from public.items where id = p.item_id;

  insert into public.messages (conversation_id, sender_id, content)
  values (p.conversation_id, auth.uid(), '✅ Approved: ' || v_item_title || ' · Pay in person when you receive it.');

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
  v_item_title text;
begin
  select * into p from public.purchases where id = p_purchase;
  if not found then raise exception 'purchase not found'; end if;
  if auth.uid() <> p.seller_id then raise exception 'only the seller can decline'; end if;
  if p.status <> 'pending' then raise exception 'purchase is not pending'; end if;

  update public.purchases set status = 'rejected' where id = p_purchase;

  select title into v_item_title from public.items where id = p.item_id;

  insert into public.messages (conversation_id, sender_id, content)
  values (p.conversation_id, auth.uid(), '❌ Declined: ' || v_item_title);

  update public.conversations
  set last_message = '❌ Purchase request declined', last_message_at = now()
  where id = p.conversation_id;
end;
$function$;

grant execute on function public.approve_purchase(uuid) to authenticated;
grant execute on function public.reject_purchase(uuid) to authenticated;

create or replace function public.mark_purchase_paid(p_purchase uuid)
returns void
language plpgsql
security definer
as $function$
declare
  p public.purchases;
begin
  select * into p from public.purchases where id = p_purchase;
  if not found then raise exception 'purchase not found'; end if;
  if auth.uid() <> p.buyer_id then raise exception 'only the buyer can pay'; end if;
  if p.status <> 'approved' then raise exception 'purchase is not approved yet'; end if;

  update public.purchases set status = 'paid', paid_at = now() where id = p_purchase;

  update public.purchases
  set status = 'cancelled'
  where item_id = p.item_id and status in ('pending', 'approved') and id <> p_purchase;

  update public.items set is_hidden = true where id = p.item_id;
end;
$function$;

create or replace function public.cancel_purchase(p_purchase uuid)
returns void
language plpgsql
security definer
as $function$
declare
  p public.purchases;
begin
  select * into p from public.purchases where id = p_purchase;
  if not found then raise exception 'purchase not found'; end if;
  if auth.uid() <> p.buyer_id and auth.uid() <> p.seller_id then
    raise exception 'not a party to this purchase';
  end if;
  if p.status not in ('pending', 'approved') then raise exception 'purchase cannot be cancelled'; end if;

  update public.purchases set status = 'cancelled' where id = p_purchase;
end;
$function$;
