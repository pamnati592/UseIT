-- Realtime Postgres Changes needs REPLICA IDENTITY FULL for UPDATE events to
-- correctly evaluate RLS and get delivered to subscribers — with the default
-- identity (primary key only), the WAL record for an UPDATE lacks the other
-- column values RLS needs to check, and the event can silently never reach a
-- subscriber even though the subscription itself is correctly set up. This is
-- exactly why the unread badge (which watches conversations UPDATEs, driven by
-- ConversationsContext) wasn't updating live across devices — transactions and
-- purchases already had FULL, which is why those live-update correctly.
alter table public.conversations replica identity full;
alter table public.messages replica identity full;
