-- ============================================================================
-- CI-only shim (Rev D R2). The supabase/postgres image ships the auth schema,
-- roles and pg_cron, but the storage schema belongs to the storage-api
-- service, not the database image — so migrations touching storage.buckets /
-- storage.objects need these stand-ins. Structure matches what the
-- migrations use; nothing more. Never run against a real Supabase project
-- (this shim intentionally normalizes the disposable image's legacy auth helpers).
-- ============================================================================

begin;

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

-- storage-api's path helper: every folder segment except the file itself.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1];
$$;

-- Supabase Auth creates auth.mfa_factors when its service starts; the
-- database image alone doesn't have it. Admin privilege reads it
-- (20261107200500), so a stand-in with the columns the migrations use.
-- The real columns are enums (auth.factor_type, auth.factor_status); the
-- migrations compare them as text, so text columns behave the same here.
create table if not exists auth.mfa_factors (
  id uuid primary key,
  user_id uuid not null,
  friendly_name text,
  factor_type text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  secret text
);
grant select on auth.mfa_factors to postgres, service_role;
-- Likewise auth.sessions: which factor raised a session to AAL2 decides
-- admin privilege (20261107200550). The real aal column is auth.aal_level.
create table if not exists auth.sessions (
  id uuid primary key,
  user_id uuid not null,
  factor_id uuid,
  aal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on auth.sessions to postgres, service_role;

-- This disposable image includes legacy claim helpers. Normalize both JWT
-- formats explicitly so fixture authentication matches the current Auth API.
-- This file is CI-only and must never be applied to a hosted project.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;
create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'anon');
$$;

commit;
