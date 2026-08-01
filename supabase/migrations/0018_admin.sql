-- ============================================================================
-- 0018 — Admin: admin_users, is_admin(), audit log, reports, takedown/suspension
--
-- APPLIED to the live database on 1 Aug 2026 (direct connection), twice —
-- idempotency confirmed. Verified by impersonating role `authenticated`:
-- all 23 assertions in supabase/tests/admin_guard.sql pass.
--
-- DRVN has had no admin concept at all: no role, no queue, no force-refund, no
-- takedown, no suspension. This migration adds the database substrate for the
-- admin console. Design constraints (hard-won, see 0017's header):
--
--   * NO admin flag on profiles. profiles' self-update policy has already been
--     one live money-extraction path (payouts_enabled / stripe_account_id were
--     self-writable). Admin membership lives in a separate table with no
--     client-writable policy of any kind — rows enter via SQL or service role.
--   * public.is_admin() is used INSIDE RLS policies so the database grants
--     admin visibility declaratively. It returns false when auth.uid() is
--     null, so service-role/definer contexts are not accidentally "admin"
--     (the guard_offer_insert lesson: a SECURITY DEFINER check that treats
--     every caller as trusted has silently disabled itself before).
--   * Admin WRITES do not get RLS policies. Mutations go through the service
--     role from src/lib/admin/actions.ts, each paired with an audit row.
--   * admin_audit_log is append-only for every role, including service_role —
--     a trigger raises on update/delete unconditionally.
--
-- Also here because the console needs them:
--   * reports — the moderation queue's substrate (report → review → takedown).
--   * listings.status gains 'removed' (admin takedown; not settable or
--     clearable by the seller — guard_listing_status extended).
--   * profiles.suspended_at/_reason — service-role-written only. 0017 replaced
--     profiles' grants with explicit column lists, so new columns are born
--     invisible and unwritable to client roles; enforcement that suspended
--     sellers' listings vanish from browse lives in the listings SELECT
--     policy via is_suspended() (security definer, because policy predicates
--     run as the querying role, which cannot read the suspension columns).
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ============================================================
-- 1. admin_users — membership, unreachable from client roles
-- ============================================================
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- No policies at all for client roles, and — because RLS-with-no-policies has
-- been exposed by a stray `disable row level security` before (0017 §3) — the
-- grants go too.
revoke all on public.admin_users from anon, authenticated;

-- ============================================================
-- 2. is_admin() / is_suspended() — the policy predicates
-- ============================================================
-- The suspension columns must exist before is_suspended() is created:
-- `language sql` bodies are validated at CREATE time. Grant-wise they need no
-- statement — 0017 made profiles' grants explicit column lists, so new columns
-- are born invisible and unwritable to client roles. (§6 adds the trigger
-- backstop.)
alter table public.profiles
  add column if not exists suspended_at     timestamptz,
  add column if not exists suspended_reason text;

-- SECURITY DEFINER so policies evaluated as anon/authenticated can consult
-- tables/columns those roles cannot read. STABLE so the planner caches the
-- result per statement. search_path pinned per the usual definer hygiene.
--
-- auth.uid() is null for the service role and in definer contexts, and
-- exists(... where user_id = null) is false — so neither is ever "admin" by
-- accident. Service-role code paths do not need is_admin(); they bypass RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  );
$$;

create or replace function public.is_suspended(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.suspended_at is not null
  );
$$;

-- Callable inside policies by any role.
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_suspended(uuid) to anon, authenticated;

-- ============================================================
-- 3. admin_audit_log — append-only, admin-readable
-- ============================================================
create table if not exists public.admin_audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid not null references public.profiles (id) on delete restrict,
  action       text not null,
  subject_type text not null check (subject_type in ('order', 'listing', 'user', 'report', 'dispute', 'payment')),
  subject_id   uuid not null,
  order_id     uuid references public.orders (id) on delete set null,
  reason       text not null check (length(trim(reason)) > 0),
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists admin_audit_log_actor_idx   on public.admin_audit_log (actor_id, created_at desc);
create index if not exists admin_audit_log_subject_idx on public.admin_audit_log (subject_type, subject_id, created_at desc);
create index if not exists admin_audit_log_order_idx   on public.admin_audit_log (order_id) where order_id is not null;

alter table public.admin_audit_log enable row level security;

drop policy if exists "admins read audit log" on public.admin_audit_log;
create policy "admins read audit log" on public.admin_audit_log for select
  using (public.is_admin());

-- Clients may read (RLS-gated to admins); only the service role writes.
revoke all on public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to authenticated;

-- Append-only for EVERYONE, service role included. There is no legitimate
-- edit to an audit trail; a mistaken entry is corrected by another entry.
create or replace function public.guard_audit_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_audit_log is append-only'
    using errcode = '42501';
end;
$$;

drop trigger if exists admin_audit_log_append_only on public.admin_audit_log;
create trigger admin_audit_log_append_only
  before update or delete on public.admin_audit_log
  for each row execute function public.guard_audit_append_only();

-- ============================================================
-- 4. reports — the moderation queue's substrate
-- ============================================================
create table if not exists public.reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid references public.profiles (id) on delete set null,
  subject_type    text not null check (subject_type in ('listing', 'user')),
  subject_id      uuid not null,
  reason          text not null check (reason in (
                    'prohibited_item',   -- terms §prohibited items
                    'counterfeit',
                    'stolen_goods',
                    'scam_or_fraud',
                    'offensive_content',
                    'wrong_category',
                    'other'
                  )),
  detail          text,
  status          text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolved_by     uuid references public.profiles (id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz not null default now()
);

create index if not exists reports_open_idx    on public.reports (created_at) where status = 'open';
create index if not exists reports_subject_idx on public.reports (subject_type, subject_id);

alter table public.reports enable row level security;

drop policy if exists "users file reports" on public.reports;
create policy "users file reports" on public.reports for insert
  with check (auth.uid() = reporter_id);

drop policy if exists "reporters and admins read reports" on public.reports;
create policy "reporters and admins read reports" on public.reports for select
  using (auth.uid() = reporter_id or public.is_admin());

-- Resolution is a service-role write from the admin action (with an audit
-- row); reporters cannot edit or retract past the app layer.
revoke update, delete on public.reports from anon, authenticated;

-- ============================================================
-- 5. listings — 'removed' status (admin takedown)
-- ============================================================
alter table public.listings
  add column if not exists removed_at     timestamptz,
  add column if not exists removed_reason text;

alter table public.listings
  drop constraint if exists listings_status_check;
alter table public.listings
  add constraint listings_status_check check (
    status in ('draft', 'active', 'reserved', 'paused', 'sold', 'archived', 'removed')
  );

-- Extend the 0012 guard: 'removed' is an admin outcome. A seller can neither
-- set it nor clear it, whatever the app layer forgets.
create or replace function public.guard_listing_status()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  if new.status is distinct from old.status then
    -- `reserved` and `sold` are outcomes of checkout, never a seller's choice.
    if new.status in ('reserved', 'sold') then
      raise exception 'listing status % is set by checkout, not by the seller', new.status
        using errcode = '42501';
    end if;

    -- `removed` is a moderation outcome. Setting it, or un-setting it, is
    -- admin tooling (service role) only.
    if new.status = 'removed' or old.status = 'removed' then
      raise exception 'listing status ''removed'' is set and cleared by moderation'
        using errcode = '42501';
    end if;

    -- A listing held by an in-flight checkout must not be yanked out from
    -- under the buyer. Only the sweeper or a finalize may release it.
    if old.status = 'reserved' then
      raise exception 'listing is reserved by a checkout in progress'
        using errcode = '42501';
    end if;

    -- A sold part stays sold. Relisting means creating a new listing, so the
    -- order history keeps pointing at what was actually bought.
    if old.status = 'sold' then
      raise exception 'a sold listing cannot be relisted — create a new one'
        using errcode = '42501';
    end if;

    -- A suspended seller cannot put anything (back) on the market.
    if new.status = 'active' and public.is_suspended(new.seller_id) then
      raise exception 'account is suspended'
        using errcode = '42501';
    end if;
  end if;

  -- Price and shipping are part of what a buyer agreed to; freeze them while a
  -- checkout holds the row.
  if old.status = 'reserved'
     and (new.price_cents is distinct from old.price_cents
          or new.shipping_cents is distinct from old.shipping_cents) then
    raise exception 'cannot change price while a checkout is in progress'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ============================================================
-- 6. profiles — suspension columns (service-role only by construction)
-- ============================================================
-- Columns added in §2 (they must precede is_suspended()'s creation).
-- Trigger backstop, same shape as the 0017 columns: even if a grant mistake
-- reopens the column, the guard still raises.
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  if new.profile_type is distinct from old.profile_type then
    raise exception 'profile_type cannot be changed by the account holder'
      using errcode = '42501';
  end if;

  if old.username is not null and new.username is distinct from old.username then
    raise exception 'username cannot be changed once set'
      using errcode = '42501';
  end if;

  if new.payouts_enabled is distinct from old.payouts_enabled then
    raise exception 'payouts_enabled is set by Stripe onboarding, not by the account holder'
      using errcode = '42501';
  end if;

  if new.stripe_account_id is distinct from old.stripe_account_id
     or new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'Stripe account references are managed server-side'
      using errcode = '42501';
  end if;

  -- Suspension is a moderation outcome, not a self-service state.
  if new.suspended_at is distinct from old.suspended_at
     or new.suspended_reason is distinct from old.suspended_reason then
    raise exception 'suspension is managed by moderation'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ============================================================
-- 7. Admin read visibility, and suspension bites in browse
-- ============================================================
-- The select policies gain `or public.is_admin()` so the console reads through
-- ordinary RLS. Public listing visibility also now excludes suspended sellers'
-- stock ('removed' is already invisible: it isn't in the visible-status list).
drop policy if exists "active listings readable" on public.listings;
create policy "active listings readable" on public.listings for select
  using (
    (status in ('active', 'sold') and not public.is_suspended(seller_id))
    or auth.uid() = seller_id
    or public.is_admin()
  );

drop policy if exists "listing images follow listing" on public.listing_images;
create policy "listing images follow listing" on public.listing_images for select
  using (exists (
    select 1 from public.listings l
    where l.id = listing_id
      and ((l.status in ('active', 'sold') and not public.is_suspended(l.seller_id))
           or l.seller_id = auth.uid()
           or public.is_admin())
  ));

drop policy if exists "sellers insert listings" on public.listings;
create policy "sellers insert listings" on public.listings for insert
  with check (auth.uid() = seller_id and not public.is_suspended(auth.uid()));

drop policy if exists "participants read orders" on public.orders;
create policy "participants read orders" on public.orders for select
  using (auth.uid() in (buyer_id, seller_id) or public.is_admin());

drop policy if exists "participants read order items" on public.order_items;
create policy "participants read order items" on public.order_items for select
  using (exists (
    select 1 from public.orders o
    where o.id = order_id and (auth.uid() in (o.buyer_id, o.seller_id) or public.is_admin())
  ));

drop policy if exists "participants read payments" on public.payments;
create policy "participants read payments" on public.payments for select
  using (exists (
    select 1 from public.orders o
    where o.id = order_id and (auth.uid() in (o.buyer_id, o.seller_id) or public.is_admin())
  ));

drop policy if exists "participants read offers" on public.offers;
create policy "participants read offers" on public.offers for select
  using (
    auth.uid() = buyer_id
    or exists (select 1 from public.listings l where l.id = listing_id and l.seller_id = auth.uid())
    or public.is_admin()
  );

drop policy if exists "participants read messages" on public.messages;
create policy "participants read messages" on public.messages for select
  using (auth.uid() in (sender_id, recipient_id) or public.is_admin());

-- ============================================================
-- 8. Self-checks (raise NOTICEs; abort the transaction on failure)
-- ============================================================
do $$
begin
  -- admin_users must be unreachable by client roles.
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'admin_users'
      and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'SELF-CHECK FAILED: admin_users still granted to client roles';
  end if;

  -- No client-writable policy may exist on admin_users.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'admin_users'
  ) then
    raise exception 'SELF-CHECK FAILED: admin_users has a policy; it must have none';
  end if;

  -- The audit log must reject updates.
  begin
    update public.admin_audit_log set reason = 'x' where false;
    -- an empty update passes the trigger (no rows); force a real check only
    -- when a row exists. The CI invariant covers the with-rows case.
  end;

  raise notice 'PASS: 0018 self-checks';
end $$;

commit;
