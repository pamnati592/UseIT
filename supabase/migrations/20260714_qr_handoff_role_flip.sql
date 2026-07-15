-- QR handoff role flip: whoever currently holds the item displays the QR;
-- whoever is receiving it scans and verifies its condition.
--   pickup: lender still holds the item (hasn't handed it over yet) -> lender displays, renter scans.
--   return: renter has been using the item -> renter displays, lender scans. (unchanged from before)
-- Condition confirmation is now only required from the scanning/receiving party —
-- the displaying party isn't verifying anything, they're just handing it off.

create or replace function public.ensure_qr_token(p_tx uuid, p_phase text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  tx public.transactions;
  token text;
  expected_displayer uuid;
begin
  select * into tx from public.transactions where id = p_tx;
  if not found then raise exception 'transaction not found'; end if;
  if p_phase not in ('pickup', 'return') then raise exception 'invalid phase'; end if;

  expected_displayer := case when p_phase = 'pickup' then tx.lender_id else tx.renter_id end;
  if auth.uid() <> expected_displayer then
    raise exception 'only the current holder of the item displays the QR for this phase';
  end if;

  if p_phase = 'pickup' then
    if tx.qr_token is null then
      token := gen_random_uuid()::text;
      update public.transactions set qr_token = token where id = p_tx;
    else
      token := tx.qr_token;
    end if;
  else
    if tx.return_qr_token is null then
      token := gen_random_uuid()::text;
      update public.transactions set return_qr_token = token where id = p_tx;
    else
      token := tx.return_qr_token;
    end if;
  end if;

  return token;
end;
$$;

create or replace function public.scan_qr_handoff(p_tx uuid, p_token text, p_phase text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  tx public.transactions;
  new_status transaction_status;
  expected_scanner uuid;
begin
  select * into tx from public.transactions where id = p_tx;
  if not found then raise exception 'transaction not found'; end if;
  if p_phase not in ('pickup', 'return') then raise exception 'invalid phase'; end if;

  expected_scanner := case when p_phase = 'pickup' then tx.renter_id else tx.lender_id end;
  if auth.uid() <> expected_scanner then
    raise exception 'only the receiving party scans the QR for this phase';
  end if;

  if p_phase = 'pickup' then
    if tx.status <> 'paid' then raise exception 'rental is not awaiting pickup'; end if;
    if tx.qr_token is null or tx.qr_token <> p_token then raise exception 'invalid QR code'; end if;
    if not tx.pickup_renter_ok then
      raise exception 'confirm the item condition first';
    end if;
    update public.transactions
      set status = 'active', picked_up_at = now()
      where id = p_tx
      returning status into new_status;

  else
    if tx.status <> 'active' then raise exception 'rental is not awaiting return'; end if;
    if tx.return_qr_token is null or tx.return_qr_token <> p_token then raise exception 'invalid QR code'; end if;
    if not tx.return_lender_ok then
      raise exception 'confirm the item condition first';
    end if;
    update public.transactions
      set status = 'completed', returned_at = now()
      where id = p_tx
      returning status into new_status;
  end if;

  return new_status::text;
end;
$$;

grant execute on function public.ensure_qr_token(uuid, text)      to authenticated;
grant execute on function public.scan_qr_handoff(uuid, text, text) to authenticated;
