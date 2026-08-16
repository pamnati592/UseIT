-- Per-rental UseIT support chat. Two separate 1:1 threads per transaction
-- (renter<->admin, lender<->admin), not one shared 3-way room — each party
-- only ever sees their own conversation with support, scoped to that
-- specific rental. Reachable from that rental's card on both sides, and
-- from the admin dispute console on the admin side.
create table public.support_threads (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id),
  user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (transaction_id, user_id)
);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.support_threads enable row level security;
alter table public.support_messages enable row level security;

create policy "support_threads: owner or admin read" on public.support_threads
  for select using (user_id = auth.uid() or public.is_admin());

create policy "support_messages: owner or admin read" on public.support_messages
  for select using (
    exists (select 1 from public.support_threads st where st.id = support_messages.thread_id
            and (st.user_id = auth.uid() or public.is_admin()))
  );

create policy "support_messages: owner or admin insert" on public.support_messages
  for insert with check (
    sender_id = auth.uid()
    and exists (select 1 from public.support_threads st where st.id = support_messages.thread_id
                and (st.user_id = auth.uid() or public.is_admin()))
  );

-- Get-or-create for the calling user's own thread on a rental they're a party
-- to. Renter or lender only — admin threads are created via the admin
-- variant below, since the admin isn't the thread owner.
create or replace function public.ensure_support_thread(p_transaction_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tx public.transactions;
  v_thread_id uuid;
begin
  select * into tx from public.transactions where id = p_transaction_id;
  if not found then raise exception 'transaction not found'; end if;
  if auth.uid() <> tx.renter_id and auth.uid() <> tx.lender_id then
    raise exception 'not a party to this transaction';
  end if;

  select id into v_thread_id from public.support_threads
  where transaction_id = p_transaction_id and user_id = auth.uid();

  if v_thread_id is null then
    insert into public.support_threads (transaction_id, user_id)
    values (p_transaction_id, auth.uid())
    returning id into v_thread_id;
  end if;

  return v_thread_id;
end;
$function$;

-- Admin variant: opens (or creates) a specific party's thread on a rental,
-- since the admin can't call ensure_support_thread (they're never the
-- thread's user_id).
create or replace function public.admin_ensure_support_thread(p_transaction_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tx public.transactions;
  v_thread_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select * into tx from public.transactions where id = p_transaction_id;
  if not found then raise exception 'transaction not found'; end if;
  if p_user_id <> tx.renter_id and p_user_id <> tx.lender_id then
    raise exception 'user is not a party to this transaction';
  end if;

  select id into v_thread_id from public.support_threads
  where transaction_id = p_transaction_id and user_id = p_user_id;

  if v_thread_id is null then
    insert into public.support_threads (transaction_id, user_id)
    values (p_transaction_id, p_user_id)
    returning id into v_thread_id;
  end if;

  return v_thread_id;
end;
$function$;
