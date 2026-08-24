-- Backlog AA: no reports table, no client-facing report/block action
-- anywhere. Separate from admin_set_user_banned (the enforcement action
-- already exists) -- this is the missing intake. RLS enabled with no
-- direct client policies, same convention as disputes/support_threads:
-- every access goes through a SECURITY DEFINER RPC.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id),
  reported_user_id uuid not null references public.profiles(id),
  reason text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id)
);

alter table public.reports enable row level security;

create or replace function public.report_user(
  p_reported_user_id uuid,
  p_reason text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  report_id uuid;
begin
  if p_reported_user_id = auth.uid() then
    raise exception 'cannot report yourself';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason is required';
  end if;

  insert into public.reports (reporter_id, reported_user_id, reason, description)
  values (auth.uid(), p_reported_user_id, p_reason, p_description)
  returning id into report_id;

  return report_id;
end;
$function$;

create or replace function public.admin_list_reports()
returns table(
  id uuid,
  reporter_id uuid,
  reporter_name text,
  reported_user_id uuid,
  reported_user_name text,
  reason text,
  description text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  return query
  select r.id, r.reporter_id, rp.full_name, r.reported_user_id, tp.full_name,
    r.reason, r.description, r.created_at
  from public.reports r
  join public.profiles rp on rp.id = r.reporter_id
  join public.profiles tp on tp.id = r.reported_user_id
  where r.status = 'open'
  order by r.created_at desc;
end;
$function$;

create or replace function public.admin_dismiss_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.reports
  set status = 'dismissed', reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_report_id;
end;
$function$;
