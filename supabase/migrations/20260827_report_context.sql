-- Extends user reporting with optional context so an admin reviewing a
-- report isn't working blind: a report filed from inside a chat carries the
-- conversation id (so the admin can read what was actually said), and a
-- report filed from an item's listing carries the item id (so the admin can
-- see the flagged content directly). Both are validated server-side, not
-- just trusted from the client, matching this project's SAS convention that
-- security-relevant checks live in the RPC, not the UI: a caller can't claim
-- a conversation they aren't in, or attach an item that isn't actually owned
-- by the person they're reporting.

alter table public.reports
  add column context_conversation_id uuid references public.conversations(id),
  add column context_item_id uuid references public.items(id);

create or replace function public.report_user(
  p_reported_user_id uuid,
  p_reason text,
  p_description text default null,
  p_conversation_id uuid default null,
  p_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  report_id uuid;
  conv public.conversations;
  item_owner uuid;
begin
  if p_reported_user_id = auth.uid() then
    raise exception 'cannot report yourself';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason is required';
  end if;

  if p_conversation_id is not null then
    select * into conv from public.conversations where id = p_conversation_id;
    if not found then raise exception 'conversation not found'; end if;
    if auth.uid() not in (conv.renter_id, conv.lender_id) then
      raise exception 'not a party to this conversation';
    end if;
    if p_reported_user_id not in (conv.renter_id, conv.lender_id) or p_reported_user_id = auth.uid() then
      raise exception 'reported user is not the other party in this conversation';
    end if;
  end if;

  if p_item_id is not null then
    select owner_id into item_owner from public.items where id = p_item_id;
    if not found then raise exception 'item not found'; end if;
    if item_owner <> p_reported_user_id then
      raise exception 'item does not belong to the reported user';
    end if;
  end if;

  insert into public.reports (reporter_id, reported_user_id, reason, description, context_conversation_id, context_item_id)
  values (auth.uid(), p_reported_user_id, p_reason, p_description, p_conversation_id, p_item_id)
  returning id into report_id;

  return report_id;
end;
$function$;

drop function if exists public.admin_list_reports();

create or replace function public.admin_list_reports()
returns table(
  id uuid, reporter_id uuid, reporter_name text,
  reported_user_id uuid, reported_user_name text,
  reason text, description text, created_at timestamptz,
  context_conversation_id uuid, context_item_id uuid,
  item_title text, item_photo text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  return query
  select r.id, r.reporter_id, rp.full_name, r.reported_user_id, tp.full_name,
    r.reason, r.description, r.created_at,
    r.context_conversation_id, r.context_item_id,
    i.title, i.photos[1]
  from public.reports r
  join public.profiles rp on rp.id = r.reporter_id
  join public.profiles tp on tp.id = r.reported_user_id
  left join public.items i on i.id = r.context_item_id
  where r.status = 'open'
  order by r.created_at desc;
end;
$function$;

-- Read-only: an admin reviewing a report needs to see what was actually said
-- in the conversation it references, without becoming a participant (no
-- reply capability here — that's deliberately not this screen's job).
create or replace function public.admin_get_conversation_messages(p_conversation_id uuid)
returns table(
  message_id uuid, sender_id uuid, sender_name text, content text, created_at timestamptz,
  item_title text, renter_name text, lender_name text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  return query
  select m.id, m.sender_id, sp.full_name, m.content, m.created_at,
    i.title, rp.full_name, lp.full_name
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  join public.profiles sp on sp.id = m.sender_id
  join public.items i on i.id = c.item_id
  join public.profiles rp on rp.id = c.renter_id
  join public.profiles lp on lp.id = c.lender_id
  where m.conversation_id = p_conversation_id
  order by m.created_at asc;
end;
$function$;
