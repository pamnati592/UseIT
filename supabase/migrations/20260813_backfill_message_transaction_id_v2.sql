-- The 2026-05-10 backfill (20260510_backfill_message_transaction_id.sql) missed
-- 12 rows — demo/seed messages inserted after that migration ran with
-- fabricated past created_at timestamps. Untagged system messages
-- (transaction_id null) leak into the plain Chat tab, which is supposed to
-- show only user-typed text — status updates belong on the Deal Board card
-- alone. Re-running the same match logic is safe/idempotent and catches them.
UPDATE public.messages m
SET transaction_id = t.id
FROM public.transactions t
WHERE m.transaction_id IS NULL
  AND m.conversation_id = t.conversation_id
  AND (
    m.content LIKE '%approved%'
    OR m.content LIKE '%declined%'
    OR m.content LIKE '%Payment completed%'
    OR m.content LIKE '%cancelled by the lender%'
  )
  AND m.content LIKE '%' || to_char(t.start_date, 'FMDD Mon') || '%';
