-- Backlog AB: verification_image_url was uploaded to the public item-images
-- bucket; spec 4.7 says admin-only. New private bucket, scoped the same way
-- item-images' owner policies already are: path prefix = uploader's own
-- auth.uid(), matching AddItemScreen's existing `${user.id}/verification-...`
-- upload path. Admins can read any photo (for moderation); nobody else can.
insert into storage.buckets (id, name, public)
values ('verification-photos', 'verification-photos', false)
on conflict (id) do nothing;

create policy "verification photos: owner upload"
on storage.objects for insert
with check (
  bucket_id = 'verification-photos'
  and (auth.uid())::text = (storage.foldername(name))[1]
);

create policy "verification photos: owner or admin read"
on storage.objects for select
using (
  bucket_id = 'verification-photos'
  and ((auth.uid())::text = (storage.foldername(name))[1] or public.is_admin())
);
