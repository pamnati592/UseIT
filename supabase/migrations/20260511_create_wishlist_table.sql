create table public.wishlist (
  user_id    uuid not null references auth.users(id) on delete cascade,
  item_id    uuid not null references public.items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.wishlist enable row level security;

create policy wishlist_own_rows
  on public.wishlist for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
