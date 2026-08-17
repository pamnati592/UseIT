-- Support threads had zero notification signal — the only way a user found
-- out UseIT messaged them was stumbling into "Message UseIT About This" on
-- the relevant rental card. Requested 2026-08-17: fold support threads into
-- the same unified unread system (ConversationsContext) everything else in
-- the Chats list already uses, rather than inventing a second mechanism.
--
-- Mirrors conversations' last_message/last_message_at/*_last_read_at shape,
-- simplified to one read field since a support thread only has one non-admin
-- party (user_id) — the admin isn't a participant with a read field, same
-- precedent as admin_resolve_dispute and the admin-charge messages.
alter table public.support_threads
  add column last_message text,
  add column last_message_at timestamptz,
  add column user_last_read_at timestamptz;

create policy "support_threads: owner or admin update" on public.support_threads
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
