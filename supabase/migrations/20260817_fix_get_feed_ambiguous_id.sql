-- get_feed has been completely broken for every authenticated call since it
-- shipped (2026-08-16, backlog E) — RETURNS TABLE(id uuid, ...) makes `id` an
-- implicit plpgsql variable in scope for the whole function body, which
-- collides with profiles.id in two internal lookups ("column reference \"id\"
-- is ambiguous"). Found 2026-08-17 while investigating the home feed showing
-- "no items in radius" for a real logged-in user — it wasn't a radius issue,
-- get_feed was throwing on every call and the client was swallowing the error
-- into an empty list. The one "verified live" test run for backlog E must
-- have run unauthenticated (auth.uid() null skips both broken branches),
-- which is why this passed then and broke for every real user since.
create or replace function public.get_feed(p_lat double precision default null, p_lng double precision default null, p_radius_km double precision default null)
returns table(id uuid, owner_id uuid, title text, description text, daily_price numeric, sale_price numeric, category text, city text, photos text[], distance_meters double precision)
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
    base.sale_price, base.category, base.city, base.photos, base.distance_meters
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
