-- A sold item can't also be a future rental commitment on the same physical
-- object. approve_purchase now blocks approval if the item has an
-- approved/paid/active rental whose period hasn't ended yet, and tells the
-- seller which dates conflict so they can resolve it (cancel the rental,
-- or decline the purchase) before selling out from under a renter.
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
  set last_message = '✅ Approved · Ready for pickup', last_message_at = now()
  where id = p.conversation_id;
end;
$function$;
