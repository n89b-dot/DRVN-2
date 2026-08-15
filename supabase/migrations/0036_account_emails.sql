-- 0036 — account_emails: a service-role-only email → account index.
--
-- Guest checkout has to answer one question before it can place an order:
-- "does this email already have an account?" The admin API has no email
-- filter, and paging every user on each checkout is not an option.
--
-- The obvious move — a column on `profiles` — is wrong: profiles are publicly
-- readable (that's what /u/<username> is), so an email column there would
-- publish every member's address. This is a separate table with RLS enabled
-- and DELIBERATELY NO POLICIES: anon and authenticated can read nothing at
-- all, and only the service role (which bypasses RLS) can use it. Nothing in
-- the client-facing app ever selects from it.
--
-- Kept in step with auth.users by trigger, and backfilled once here.
--
-- Idempotent: guarded throughout. Safe to re-run.

begin;

create table if not exists public.account_emails (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Addresses are matched case-insensitively; the column stores the normalised
-- form so the index is a plain unique one rather than an expression.
create unique index if not exists account_emails_email_key
  on public.account_emails (email);

alter table public.account_emails enable row level security;

-- No policies, on purpose. Every client role is locked out; the service role
-- bypasses RLS. Belt and braces on top of that:
revoke all on public.account_emails from anon, authenticated;

comment on table public.account_emails is
  'Service-role-only email → account index for guest checkout. RLS enabled with no policies: unreadable by anon/authenticated. Never expose through PostgREST.';

-- ============================================================
-- Sync with auth.users
-- ============================================================
create or replace function public.sync_account_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null then
    delete from public.account_emails where user_id = new.id;
    return new;
  end if;

  insert into public.account_emails (user_id, email)
  values (new.id, lower(trim(new.email)))
  on conflict (user_id) do update
    set email = excluded.email, updated_at = now();

  return new;
end;
$$;

drop trigger if exists users_sync_account_email on auth.users;
create trigger users_sync_account_email
  after insert or update of email on auth.users
  for each row execute function public.sync_account_email();

-- ============================================================
-- Backfill
-- ============================================================
insert into public.account_emails (user_id, email)
select u.id, lower(trim(u.email))
from auth.users u
where u.email is not null
on conflict (user_id) do update
  set email = excluded.email, updated_at = now();

-- ============================================================
-- Self-checks
-- ============================================================
do $$
declare
  v_users int;
  v_indexed int;
  v_policies int;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'account_emails'
  ) then
    raise exception '0036: account_emails missing';
  end if;

  -- The whole point of the table is that clients cannot read it.
  select count(*) into v_policies
  from pg_policies where schemaname = 'public' and tablename = 'account_emails';
  if v_policies > 0 then
    raise exception '0036: account_emails must have no RLS policies, found %', v_policies;
  end if;

  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'account_emails' and rowsecurity
  ) then
    raise exception '0036: RLS not enabled on account_emails';
  end if;

  select count(*) into v_users from auth.users where email is not null;
  select count(*) into v_indexed from public.account_emails;
  if v_indexed < v_users then
    raise exception '0036: backfill incomplete — % users, % indexed', v_users, v_indexed;
  end if;

  raise notice 'PASS: 0036 self-checks (% addresses indexed)', v_indexed;
end $$;

commit;
