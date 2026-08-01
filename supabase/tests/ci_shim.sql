-- ============================================================================
-- CI-only shim (Rev D R2). The supabase/postgres image ships the auth schema,
-- roles and pg_cron, but the storage schema belongs to the storage-api
-- service, not the database image — so migrations touching storage.buckets /
-- storage.objects need these stand-ins. Structure matches what the
-- migrations use; nothing more. Never run against a real Supabase project
-- (they already have the real thing; `if not exists` makes it a no-op there).
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

-- The image usually provides these; create only when absent so a fuller
-- image wins.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    create function auth.uid() returns uuid
      language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'role'
  ) then
    create function auth.role() returns text
      language sql stable
      as 'select coalesce(nullif(current_setting(''request.jwt.claim.role'', true), ''''), ''anon'')';
  end if;
end $$;

commit;
