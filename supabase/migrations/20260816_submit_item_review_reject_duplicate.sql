-- submit_rating was hardened on 2026-08-09 to reject a second attempt instead
-- of silently upserting (a duplicate rating was overwriting the previous score
-- and recomputing lender_score/renter_score from it). submit_item_review had
-- the same on-conflict-do-update shape and was never given the same guard —
-- not reachable today via the UI (RatingScreen gates on hasRatedTransaction,
-- which checks ratings, and both submissions fire together), but a partial
-- failure between the two RPC calls would leave it exploitable, and it should
-- match submit_rating's behavior regardless.
create or replace function public.submit_item_review(p_tx uuid, p_score integer, p_comment text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tx public.transactions;
begin
  select * into tx from public.transactions where id = p_tx;
  if not found then raise exception 'transaction not found'; end if;
  if auth.uid() <> tx.renter_id then
    raise exception 'only the renter can review the item';
  end if;
  if tx.status <> 'completed' then
    raise exception 'rental is not completed yet';
  end if;
  if p_score < 1 or p_score > 5 then
    raise exception 'score must be between 1 and 5';
  end if;
  if exists (select 1 from public.item_reviews where transaction_id = p_tx and reviewer_id = auth.uid()) then
    raise exception 'you have already reviewed this item';
  end if;

  insert into public.item_reviews (transaction_id, item_id, reviewer_id, score, comment)
  values (p_tx, tx.item_id, auth.uid(), p_score, p_comment);

  update public.items set
    avg_rating   = (select avg(score) from public.item_reviews where item_id = tx.item_id),
    review_count = (select count(*)   from public.item_reviews where item_id = tx.item_id)
  where id = tx.item_id;
end;
$function$;
