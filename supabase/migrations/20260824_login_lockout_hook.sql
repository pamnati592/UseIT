-- Spec 5.2: lock after 5 failed login attempts. Supabase Auth's own
-- password verification isn't interceptable from app code or a normal
-- RPC -- GoTrue owns password checking entirely. The only real hook point
-- is the "Password Verification Attempt" Auth Hook, which fires on every
-- sign-in try (success or failure) and lets this function accept/reject it.
-- The function and its permissions are fully wired here, but Auth Hooks
-- themselves are enabled in the Dashboard, not via migration -- see the
-- one-time setup step noted in the commit message; nothing below does
-- anything until that's done.
create table public.auth_failed_attempts (
  user_id uuid primary key references public.profiles(id),
  failed_count integer not null default 0,
  locked_until timestamptz
);

alter table public.auth_failed_attempts enable row level security;

-- Only the auth hook (running as supabase_auth_admin) ever touches this --
-- no policy at all for anon/authenticated, and a dedicated one scoped to
-- that specific role rather than relying on security definer, which would
-- otherwise run as this migration's owning role and risk over-broad
-- privileges on something invoked automatically by the auth service.
create policy "auth hook: full access" on public.auth_failed_attempts
  for all
  to supabase_auth_admin
  using (true)
  with check (true);

create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_user_id uuid := (event->>'user_id')::uuid;
  v_valid boolean := (event->>'valid')::boolean;
  v_row public.auth_failed_attempts;
begin
  select * into v_row from public.auth_failed_attempts where user_id = v_user_id;

  -- Already locked -- reject regardless of whether this attempt's password
  -- was actually correct, until the lockout window passes.
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'Too many failed attempts. Try again after ' || to_char(v_row.locked_until, 'HH24:MI') || '.'
    );
  end if;

  if v_valid then
    -- Correct password clears the slate.
    if v_row.user_id is not null then
      update public.auth_failed_attempts set failed_count = 0, locked_until = null where user_id = v_user_id;
    end if;
    return jsonb_build_object('decision', 'continue');
  end if;

  -- Wrong password: increment, lock for 15 minutes at 5 failures.
  insert into public.auth_failed_attempts (user_id, failed_count)
  values (v_user_id, 1)
  on conflict (user_id) do update
    set failed_count = auth_failed_attempts.failed_count + 1,
        locked_until = case
          when auth_failed_attempts.failed_count + 1 >= 5 then now() + interval '15 minutes'
          else null
        end;

  select * into v_row from public.auth_failed_attempts where user_id = v_user_id;
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'Too many failed attempts. Try again after ' || to_char(v_row.locked_until, 'HH24:MI') || '.'
    );
  end if;

  -- Under the threshold — let Supabase's own normal "invalid credentials"
  -- error handle this attempt; the hook only adds the lockout on top.
  return jsonb_build_object('decision', 'continue');
end;
$function$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_password_verification_attempt(jsonb) from authenticated, anon, public;
