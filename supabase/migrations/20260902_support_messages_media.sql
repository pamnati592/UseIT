-- Photo support for support chat, mirroring messages' own chat media
-- (20260831_chat_media.sql) exactly: a type column plus an optional private
-- storage path, signed URL minted at display time. Needed so a photo
-- attached from Get Help actually shows up in the UseIT support thread
-- instead of being silently dropped.

alter table public.support_messages
  add column message_type text not null default 'text'
    check (message_type in ('text', 'image')),
  add column media_path text;

insert into storage.buckets (id, name, public)
values ('support-media', 'support-media', false)
on conflict (id) do nothing;

-- Same owner-or-admin scoping as support_messages' own RLS policies —
-- the first path segment is the thread id.
create policy "support media: owner or admin read" on storage.objects
for select using (
  bucket_id = 'support-media'
  and exists (
    select 1 from public.support_threads st
    where st.id::text = (storage.foldername(objects.name))[1]
      and (st.user_id = auth.uid() or public.is_admin())
  )
);

create policy "support media: owner or admin upload" on storage.objects
for insert with check (
  bucket_id = 'support-media'
  and exists (
    select 1 from public.support_threads st
    where st.id::text = (storage.foldername(objects.name))[1]
      and (st.user_id = auth.uid() or public.is_admin())
  )
);
