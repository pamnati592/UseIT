-- Found while building the reviews-by-role screen (2026-08-19): a plain
-- client-side join from ratings through transactions silently breaks for any
-- viewer who isn't a party to the underlying rental — "transactions: read
-- own" RLS restricts transactions to renter_id = auth.uid() or lender_id =
-- auth.uid(). PublicProfileScreen's existing lenderReviewCount/
-- renterReviewCount already had this same bug (undercounting for any viewer
-- who wasn't personally involved in the reviewee's rentals) since it did the
-- same client-side embed. A public trust score needs to be visible to
-- everyone, not just people who've transacted with that user themselves.
--
-- Narrow SECURITY DEFINER RPC: returns only the review-relevant fields
-- (score, comment, reviewer name, item title) — never the raw transaction
-- row (dates, price, the other party's identity), so this doesn't widen
-- what's actually public beyond what a review should reasonably expose.
create or replace function public.list_role_reviews(p_user_id uuid, p_role text)
returns table(
  id uuid,
  score smallint,
  comment text,
  created_at timestamptz,
  reviewer_name text,
  item_title text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_role not in ('lender', 'renter') then raise exception 'p_role must be lender or renter'; end if;

  return query
  select r.id, r.score, r.comment, r.created_at, p.full_name, i.title
  from public.ratings r
  join public.transactions t on t.id = r.transaction_id
  join public.profiles p on p.id = r.reviewer_id
  join public.items i on i.id = t.item_id
  where r.reviewee_id = p_user_id
    and (
      (p_role = 'lender' and t.lender_id = p_user_id)
      or (p_role = 'renter' and t.renter_id = p_user_id)
    )
  order by r.created_at desc;
end;
$function$;

grant execute on function public.list_role_reviews(uuid, text) to authenticated;
