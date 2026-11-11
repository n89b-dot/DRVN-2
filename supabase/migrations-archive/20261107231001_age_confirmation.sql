-- ============================================================================
-- 20261107231001 — 18+ confirmation (R69-age)
--
-- The Terms say members must be 18 or over; nothing asked. This records the
-- answer. A date of birth is never collected: the record is the moment the
-- person confirmed, and where.
--
--  1. public.age_confirmations — one row per account, written only by the
--     server (service role): email sign-up, onboarding after a first Google
--     sign-in, and guest checkout before the order email goes out. A member
--     can read their own row and nothing else; no member writes at all.
--  2. A profile can't get its handle without one. Setting `username` for the
--     first time is what finishes onboarding, so a member who calls the API
--     directly (skipping the form and the server action) is refused here.
--     Server writers (service role, migrations, security-definer functions)
--     are not checked: the server actions check before they write, and
--     fixtures and repairs need to set handles.
--
-- Existing members are not backfilled: there is no answer to copy, and
-- inventing one would be worse than none. The check applies only when a
-- handle is first set, so their profiles are untouched.
--
-- Idempotent.
-- ============================================================================

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.age_confirmations (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  age_confirmed_at timestamptz not null default now(),
  source           text not null check (source in ('email_signup', 'onboarding', 'guest_checkout'))
);

comment on table public.age_confirmations is
  'When an account confirmed it is 18 or over, and where. No date of birth is stored. Written by the server only (R69-age).';

alter table public.age_confirmations enable row level security;
revoke all on public.age_confirmations from public, anon, authenticated;
grant select on public.age_confirmations to authenticated;
grant select, insert, delete on public.age_confirmations to service_role;

drop policy if exists "members read their own age confirmation" on public.age_confirmations;
create policy "members read their own age confirmation" on public.age_confirmations
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- The answer is a fact about a moment: it is never rewritten.
create or replace function private.guard_age_confirmation_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'An age confirmation is never rewritten' using errcode = '42501';
end;
$$;
revoke all on function private.guard_age_confirmation_immutable() from public, anon, authenticated;

drop trigger if exists age_confirmations_immutable on public.age_confirmations;
create trigger age_confirmations_immutable
  before update on public.age_confirmations
  for each row execute function private.guard_age_confirmation_immutable();

-- Runs as the caller (not security definer): is_trusted_writer() reads
-- current_user, which a definer function would always report as its owner.
-- A member's own row is readable under the policy above.
create or replace function public.guard_profile_age_confirmed()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;
  if new.username is not null
     and (tg_op = 'INSERT' or old.username is null)
     and not exists (select 1 from public.age_confirmations a where a.user_id = new.id) then
    raise exception 'Confirm you are 18 or over before choosing a handle'
      using errcode = '42501', hint = 'age_not_confirmed';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_require_age_confirmation on public.profiles;
create trigger profiles_require_age_confirmation
  before insert or update of username on public.profiles
  for each row execute function public.guard_profile_age_confirmed();

do $$
begin
  if has_table_privilege('authenticated', 'public.age_confirmations', 'insert')
     or has_table_privilege('anon', 'public.age_confirmations', 'select') then
    raise exception '20261107231001: age confirmations must be server-written and private';
  end if;
end $$;

commit;
