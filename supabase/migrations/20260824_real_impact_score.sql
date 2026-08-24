-- Backlog R: Impact Score was a fake number everywhere it appeared --
-- format.ts hashed the item's own id into a fixed 3.2-4.9 range (same
-- item always shows the same score, unrelated to anything real about it),
-- QRDisplayScreen hardcoded 4.0, QRScanScreen hardcoded 4.4 literally in
-- the JSX. Real formula: a per-category baseline (rough relative estimate
-- of embodied-carbon avoided by sharing that kind of item instead of
-- everyone buying their own) plus a small bonus per completed rental
-- (reuse), capped at 5.0. Not a measured/authoritative CO2 figure --
-- there's no such data source here -- but it's now driven by the item's
-- real category and real rental history instead of an opaque hash.
alter table public.items add column completed_rental_count integer not null default 0;

update public.items i set completed_rental_count = (
  select count(*) from public.transactions t
  where t.item_id = i.id and t.status = 'completed'
);

-- The one place a rental transaction actually becomes completed (return
-- scan) -- matches the existing convention of updating rollup columns
-- inline in the relevant RPC rather than a trigger (see submit_item_review
-- for avg_rating/review_count).
create or replace function public.scan_qr_handoff(p_tx uuid, p_token text, p_phase text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
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

    update public.items set completed_rental_count = completed_rental_count + 1 where id = tx.item_id;
  end if;

  return new_status::text;
end;
$function$;

-- get_feed is the main swipe-feed surface -- add the new column so the
-- Home screen's item cards can compute a real score without a per-card
-- round trip. Return type is changing, so CREATE OR REPLACE isn't enough --
-- Postgres requires the old signature dropped first.
drop function public.get_feed(double precision, double precision, double precision);

create function public.get_feed(p_lat double precision default null, p_lng double precision default null, p_radius_km double precision default null)
returns table(id uuid, owner_id uuid, title text, description text, daily_price numeric, sale_price numeric, category text, city text, photos text[], distance_meters double precision, completed_rental_count integer)
language plpgsql
stable
as $function$
declare
  v_origin geography;
  v_interests text[];
begin
  if p_lat is not null and p_lng is not null then
    v_origin := st_makepoint(p_lng, p_lat)::geography;
  elsif auth.uid() is not null then
    select p.location into v_origin from public.profiles p where p.id = auth.uid();
  end if;

  if auth.uid() is not null then
    select p.interests into v_interests from public.profiles p where p.id = auth.uid();
  end if;

  return query
  with base as (
    select
      i.id, i.owner_id, i.title, i.description, i.daily_price,
      i.sale_price, i.category, i.city, i.photos, i.tags, i.created_at,
      i.completed_rental_count,
      p.lender_score,
      case
        when v_origin is null or i.location is null then null
        else st_distance(i.location, v_origin)
      end as distance_meters
    from public.items i
    left join public.profiles p on p.id = i.owner_id
    where i.verification_status = 'live'
      and i.is_hidden = false
      and (auth.uid() is null or i.owner_id <> auth.uid())
      and (
        p_radius_km is null
        or v_origin is null
        or (i.location is not null and st_dwithin(i.location, v_origin, p_radius_km * 1000))
      )
  )
  select
    base.id, base.owner_id, base.title, base.description, base.daily_price,
    base.sale_price, base.category, base.city, base.photos, base.distance_meters,
    base.completed_rental_count
  from base
  order by
    (
      0.50 * (
        case
          when base.distance_meters is null then 0.5
          when p_radius_km is not null and p_radius_km > 0
            then greatest(0, 1 - (base.distance_meters / 1000.0) / p_radius_km)
          else 1 / (1 + (base.distance_meters / 1000.0) / 20.0)
        end
      )
      + 0.25 * (
        case when coalesce(base.lender_score, 0) = 0 then 0.6 else base.lender_score / 5.0 end
      )
      + 0.15 * (
        case when v_interests is not null and v_interests && (array[base.category] || coalesce(base.tags, array[]::text[])) then 1 else 0 end
      )
      + 0.10 * (
        exp(-0.0231 * extract(epoch from (now() - base.created_at)) / 86400)
      )
    ) desc,
    base.distance_meters asc nulls last,
    base.created_at desc;
end;
$function$;
