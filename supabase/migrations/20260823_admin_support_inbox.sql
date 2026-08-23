-- Real gap found 2026-08-19 while discussing multi-admin support: a user can
-- open "Contact UseIT -> Message UseIT" on ANY paid/active rental, not just a
-- disputed or overdue one, but there was no admin-side screen that could
-- discover that thread — only AdminDisputesScreen/AdminOverdueScreen exist,
-- both scoped to their own specific transaction status. A message to support
-- about an ordinary rental had nowhere for any admin to actually see it.
--
-- admin_last_read_at is a single shared field (not per-admin) — this is
-- deliberately a shared-inbox model (any admin can read/reply to any
-- thread, matching the existing RLS), so "read" means "some admin has seen
-- this," same simplification already used for support_threads.user_last_read_at.
alter table public.support_threads
  add column admin_last_read_at timestamptz;

create or replace function public.admin_list_support_threads()
returns table(
  id uuid,
  transaction_id uuid,
  user_id uuid,
  user_name text,
  role text,
  item_title text,
  last_message text,
  last_message_at timestamptz,
  admin_last_read_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  return query
  select
    st.id, st.transaction_id, st.user_id, p.full_name,
    case when t.renter_id = st.user_id then 'renter' else 'lender' end,
    i.title, st.last_message, st.last_message_at, st.admin_last_read_at
  from public.support_threads st
  join public.transactions t on t.id = st.transaction_id
  join public.items i on i.id = t.item_id
  join public.profiles p on p.id = st.user_id
  order by st.last_message_at desc nulls last;
end;
$function$;

grant execute on function public.admin_list_support_threads() to authenticated;
