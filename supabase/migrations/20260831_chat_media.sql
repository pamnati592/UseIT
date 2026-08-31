-- Adds photo and voice-message support to chat. Messages gain a type and an
-- optional storage path (never a URL — chat-media is a private bucket, same
-- convention as handoff-evidence: persist the path, mint a signed URL at
-- display time). `content` stays populated with a short emoji label for
-- non-text messages so every existing "last message" preview / notification
-- codepath that just reads `content` keeps working without branching on type.

alter table public.messages
  add column message_type text not null default 'text'
    check (message_type in ('text', 'image', 'audio')),
  add column media_path text,
  add column media_duration_seconds integer;

insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', false)
on conflict (id) do nothing;

-- Same shape as handoff-evidence's policies: the first path segment must be
-- the conversation id, and RLS checks the caller is a party to it — matches
-- messages' own RLS so a chat photo/voice note is exactly as private as the
-- conversation it belongs to.
create policy "chat media: parties read" on storage.objects
for select using (
  bucket_id = 'chat-media'
  and exists (
    select 1 from public.conversations c
    where c.id::text = (storage.foldername(objects.name))[1]
      and (c.renter_id = auth.uid() or c.lender_id = auth.uid())
  )
);

create policy "chat media: parties upload" on storage.objects
for insert with check (
  bucket_id = 'chat-media'
  and exists (
    select 1 from public.conversations c
    where c.id::text = (storage.foldername(objects.name))[1]
      and (c.renter_id = auth.uid() or c.lender_id = auth.uid())
  )
);
