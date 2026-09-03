-- Follow-up to allowing admin_open_dispute on 'completed' transactions:
-- admin_resolve_dispute unconditionally set status to 'cancelled' (favor
-- renter) or 'completed' (favor lender) with no awareness of where the
-- dispute started from. For a dispute opened DURING a rental (paid/active)
-- that's the right call — but for one opened AFTER the handoff already
-- completed (damage found post-return), a favor-renter ruling would
-- wrongly mark a rental that genuinely happened as 'cancelled'. That status
-- feeds completed-rental counts, trust scores, and Impact Score elsewhere,
-- so getting it wrong here is not just cosmetic.
--
-- Fix: remember the status a transaction had right before a dispute opened
-- it, and resolve back to 'completed' regardless of favor if that was
-- 'completed' — the physical exchange already happened either way; only
-- the money/damage outcome differs.
alter table public.transactions
  add column if not exists pre_dispute_status text;

create or replace function public.admin_open_dispute(
  p_transaction_id uuid,
  p_user_id uuid,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tx public.transactions;
  dispute_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select * into tx from public.transactions where id = p_transaction_id;
  if not found then raise exception 'transaction not found'; end if;
  if p_user_id <> tx.renter_id and p_user_id <> tx.lender_id then
    raise exception 'user is not a party to this transaction';
  end if;
  if tx.status not in ('paid', 'active', 'completed', 'disputed') then
    raise exception 'transaction is not open for dispute (status: %)', tx.status;
  end if;

  -- Only capture on the transition INTO disputed, not on a repeat call
  -- against an already-disputed transaction (status would just be
  -- 'disputed' itself at that point, which isn't what we want to remember).
  update public.transactions
    set status = 'disputed',
        pre_dispute_status = case when status <> 'disputed' then status::text else pre_dispute_status end
    where id = p_transaction_id;

  insert into public.disputes (transaction_id, reporter_id, description)
  values (p_transaction_id, p_user_id, coalesce(p_description, 'Opened by UseIT from a support conversation'))
  on conflict (transaction_id) where status = 'open' do nothing
  returning id into dispute_id;

  if dispute_id is null then
    select id into dispute_id
    from public.disputes
    where transaction_id = p_transaction_id and status = 'open';
  end if;

  return dispute_id;
end;
$function$;

create or replace function public.admin_resolve_dispute(p_transaction_id uuid, p_favor text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  tx public.transactions;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_favor not in ('renter', 'lender') then raise exception 'p_favor must be renter or lender'; end if;

  select * into tx from public.transactions where id = p_transaction_id;
  if not found then raise exception 'transaction not found'; end if;
  if tx.status <> 'disputed' then raise exception 'transaction is not disputed'; end if;

  update public.disputes
  set status = 'resolved', resolution = 'favor_' || p_favor || coalesce(': ' || p_note, ''), resolved_at = now()
  where transaction_id = p_transaction_id and status = 'open';

  if tx.pre_dispute_status = 'completed' then
    update public.transactions set status = 'completed' where id = p_transaction_id;
  elsif p_favor = 'renter' then
    update public.transactions set status = 'cancelled' where id = p_transaction_id;
  else
    update public.transactions set status = 'completed' where id = p_transaction_id;
  end if;
end;
$function$;

-- admin_list_support_overview needs pre_dispute_status too — a disputed
-- rental should still show its real lifecycle stage (e.g. "Completed") in
-- the admin UI, with "Disputed" layered on as an additional tag rather than
-- replacing it, matching how Ori actually thinks about the two statuses.
drop function if exists public.admin_list_support_overview();

create or replace function public.admin_list_support_overview()
returns table(
  transaction_id uuid, item_title text, item_photo text, status text, pre_dispute_status text,
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
    t.id, i.title, i.photos[1], t.status::text, t.pre_dispute_status,
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
