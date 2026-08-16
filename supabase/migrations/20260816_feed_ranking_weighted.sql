-- Backlog E: get_feed ranked by distance only. Extends it into a weighted
-- score — distance stays dominant (it's the core "local pickup" value prop),
-- with lender score, interest match, and recency as secondary boosts. The
-- radius filter's behavior is unchanged (still a hard cutoff on which items
-- appear); this only changes the order within whatever radius returned.
--
-- Weights: distance 0.50, lender score 0.25, interest match 0.15, recency 0.10.
-- distance_score: when a radius is selected, linear falloff scaled to that
-- radius (so it reflects the range the user actually chose, not a fixed
-- constant); when there's no radius ("All") but a location is known, a
-- gentle decay; when there's no location signal at all, neutral (0.5) rather
-- than penalizing every item equally toward the bottom.
-- lender_score_component: brand-new lenders (score 0/no ratings yet) get a
-- neutral 0.6 for ranking purposes specifically — this is deliberately more
-- forgiving than the Trust Score tiers (spec 4.12), which treat 0 as a real
-- "New User" signal for fee discounts. A cold-start item shouldn't be
-- permanently buried in the feed just because its lender has no reviews yet.
-- interest_match: binary — any overlap between profiles.interests and the
-- item's category-or-tags, not a weighted multi-match count.
-- recency: exponential decay, ~30-day half-life (feed freshness, not the
-- ~180-day half-life used for reputation scoring — a marketplace feed should
-- turn over faster than trust does).
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
    select location into v_origin from public.profiles where id = auth.uid();
  end if;

  if auth.uid() is not null then
    select interests into v_interests from public.profiles where id = auth.uid();
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
