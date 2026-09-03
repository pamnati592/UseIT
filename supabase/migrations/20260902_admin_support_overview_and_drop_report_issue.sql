-- Replaces the admin console's two disconnected flat lists (Support Inbox,
-- Dispute Queue) with one: every rental that has support activity (an open
-- dispute, or at least one side chat with either party), ordered disputed-
-- first. Modeled on admin_list_disputes() for the item/profile join shape
-- and admin_list_support_threads() for the unread computation.
create or replace function public.admin_list_support_overview()
returns table(
  transaction_id uuid, item_title text, item_photo text, status text,
  start_date timestamptz, end_date timestamptz,
  renter_id uuid, renter_name text, renter_is_admin boolean,
  renter_thread_id uuid, renter_unread boolean,
  lender_id uuid, lender_name text, lender_is_admin boolean,
  lender_thread_id uuid, lender_unread boolean,
  has_dispute boolean, dispute_id uuid, last_activity_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  return query
  select
    t.id, i.title, i.photos[1], t.status::text,
    t.start_date, t.end_date,
    t.renter_id, rp.full_name, rp.is_admin,
    rst.id,
    (rst.last_message_at is not null and (rst.admin_last_read_at is null or rst.last_message_at > rst.admin_last_read_at)),
    t.lender_id, lp.full_name, lp.is_admin,
    lst.id,
    (lst.last_message_at is not null and (lst.admin_last_read_at is null or lst.last_message_at > lst.admin_last_read_at)),
    (d.id is not null), d.id,
    greatest(
      coalesce(rst.last_message_at, 'epoch'::timestamptz),
      coalesce(lst.last_message_at, 'epoch'::timestamptz),
      coalesce(d.created_at, 'epoch'::timestamptz)
    )
  from public.transactions t
  join public.items i on i.id = t.item_id
  join public.profiles rp on rp.id = t.renter_id
  join public.profiles lp on lp.id = t.lender_id
  left join public.support_threads rst on rst.transaction_id = t.id and rst.user_id = t.renter_id
  left join public.support_threads lst on lst.transaction_id = t.id and lst.user_id = t.lender_id
  left join public.disputes d on d.transaction_id = t.id and d.status = 'open'
  where rst.id is not null or lst.id is not null or d.id is not null
  order by
    (d.id is not null) desc,
    greatest(
      coalesce(rst.last_message_at, 'epoch'::timestamptz),
      coalesce(lst.last_message_at, 'epoch'::timestamptz),
      coalesce(d.created_at, 'epoch'::timestamptz)
    ) desc;
end;
$function$;

grant execute on function public.admin_list_support_overview() to authenticated;

-- User-facing "Report a Problem" (ChatRoomScreen) no longer creates a
-- dispute directly — it now just opens/continues the support thread like
-- any other Get Help message. admin_open_dispute is the sole remaining path
-- to a dispute, and it's already admin-gated. This was report_issue's only
-- caller (confirmed by grep before removing it from ChatRoomScreen.tsx).
drop function if exists public.report_issue(uuid, text, text);
