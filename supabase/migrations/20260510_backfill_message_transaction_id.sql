-- Backfill transaction_id on legacy system messages that were inserted before
-- the client code started tagging them. Match by the start date encoded in the
-- message text (e.g. "17 Jun") against transactions in the same conversation.
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
