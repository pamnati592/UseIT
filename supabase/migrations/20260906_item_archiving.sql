-- "Delete Item" on an item with real history (a transaction or a report) hits
-- transactions_item_id_fkey / reports_context_item_id_fkey (both NO ACTION,
-- deliberately — rental/report history has to outlive the listing it points
-- to). Rather than just refusing the delete, give the owner a real one-way
-- "remove from my listings" action: archive the row instead of removing it.
--
-- Distinct from is_hidden: Hide is a reversible feed-visibility toggle the
-- owner keeps managing in MyItemsScreen; archiving removes it from
-- MyItemsScreen entirely, on purpose, with no way back through the app.
alter table public.items
  add column if not exists archived_at timestamptz;
