-- Backlog U: admin role + moderation console. Spec section 2 defines an
-- Admin user type and 5.2 requires RBAC, but nothing existed. Rather than
-- adding blanket "admin can read/write everything" RLS policies across every
-- table (transactions, items, profiles, disputes, ...), this follows the
-- pattern already dominant throughout this codebase: SECURITY DEFINER RPCs
-- that check is_admin() internally. Same end result — an admin can act
-- across all rows — but each capability is a named, auditable function
-- scoped to exactly what the console needs, not a standing RLS grant that
-- could be forgotten about and quietly widen later.

alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists is_banned boolean not null default false;
alter table public.items add column if not exists rejection_reason text;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $function$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$function$;

-- ── Dispute queue ────────────────────────────────────────────────────────
-- Evidence (photo + description) is now collected on all three report-issue
-- paths (see the dispute-evidence consolidation earlier this project) — this
-- is what makes the queue actually useful to adjudicate, not just a list of
-- disputed transaction ids.
create or replace function public.admin_list_disputes()
returns table(
  transaction_id uuid,
  item_title text,
  item_photo text,
  start_date timestamptz,
  end_date timestamptz,
  total_price numeric,
  renter_id uuid,
  renter_name text,
  lender_id uuid,
  lender_name text,
  dispute_id uuid,
  description text,
  photo_url text,
  reporter_id uuid,
  reported_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  return query
  select
    t.id, i.title, i.photos[1], t.start_date, t.end_date, t.total_price,
    t.renter_id, rp.full_name, t.lender_id, lp.full_name,
    d.id, d.description, d.photo_url, d.reporter_id, d.created_at
  from public.transactions t
  join public.items i on i.id = t.item_id
  join public.profiles rp on rp.id = t.renter_id
  join public.profiles lp on lp.id = t.lender_id
  left join public.disputes d on d.transaction_id = t.id and d.status = 'open'
  where t.status = 'disputed'
  order by d.created_at desc nulls last;
end;
$function$;

-- Sets the transaction to the same terminal status the existing cancellation
-- paths already use before calling refund-payment (favor renter -> cancelled,
-- matching handleCancel/decline_at_pickup) or the normal successful-rental
-- terminal status (favor lender -> completed, since the lender keeps the
-- already-captured payment — there's nothing to refund). The client calls
-- refund-payment with reason 'admin_dispute_resolved' afterward when
-- favoring the renter; reusing the 'cancelled' precondition that function
-- already enforces, rather than adding a new one.
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

  if p_favor = 'renter' then
    update public.transactions set status = 'cancelled' where id = p_transaction_id;
  else
    update public.transactions set status = 'completed' where id = p_transaction_id;
  end if;
end;
$function$;

-- ── Item moderation ──────────────────────────────────────────────────────
-- Note: verification_image_url currently lives in the public item-images
-- bucket (getPublicUrl, not a signed URL) — spec 4.7 says this photo should
-- be admin-only, so the bucket choice is a pre-existing gap this doesn't fix.
-- Flagged, not silently left undocumented.
create or replace function public.admin_list_pending_items()
returns table(
  item_id uuid,
  title text,
  category text,
  description text,
  daily_price numeric,
  sale_price numeric,
  city text,
  photos text[],
  verification_image_url text,
  owner_id uuid,
  owner_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
  select i.id, i.title, i.category, i.description, i.daily_price, i.sale_price, i.city,
         i.photos, i.verification_image_url, i.owner_id, p.full_name, i.created_at
  from public.items i
  join public.profiles p on p.id = i.owner_id
  where i.verification_status = 'pending'
  order by i.created_at asc;
end;
$function$;

create or replace function public.admin_approve_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.items set verification_status = 'live', rejection_reason = null where id = p_item_id;
end;
$function$;

-- No 'rejected' value exists on item_status (draft/pending/live/rented) —
-- reusing 'draft' rather than adding a new enum value keeps the item in the
-- owner's list as an editable draft. rejection_reason is what actually tells
-- them why, surfaced in MyItemsScreen.
create or replace function public.admin_reject_item(p_item_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.items set verification_status = 'draft', rejection_reason = p_reason where id = p_item_id;
end;
$function$;

-- ── User management ──────────────────────────────────────────────────────
-- "Block or Report another user" (spec 4.11) is not persisted anywhere in
-- the app today — there is no reports table, and nothing writes to one.
-- That's a separate, real gap (needs a client-facing report button too, not
-- just an admin view) — out of scope here, flagged for its own pass.
create or replace function public.admin_list_users(p_search text default null)
returns table(
  id uuid,
  full_name text,
  phone text,
  city text,
  role text,
  lender_score double precision,
  renter_score double precision,
  lender_cancellations integer,
  is_admin boolean,
  is_banned boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
  select p.id, p.full_name, p.phone, p.city, p.role::text,
         p.lender_score, p.renter_score, p.lender_cancellations,
         p.is_admin, p.is_banned, p.created_at
  from public.profiles p
  where p_search is null or p_search = '' or p.full_name ilike '%' || p_search || '%'
  order by p.created_at desc
  limit 100;
end;
$function$;

create or replace function public.admin_set_user_banned(p_user_id uuid, p_banned boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_user_id = auth.uid() then raise exception 'cannot ban yourself'; end if;
  update public.profiles set is_banned = p_banned where id = p_user_id;
end;
$function$;
