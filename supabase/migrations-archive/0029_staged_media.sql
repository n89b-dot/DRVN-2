-- ============================================================================
-- 0029 — Staged media uploads (P0)
--
-- Photos upload to storage client-side the moment they're picked, but the DB
-- rows that reference them are only written on submit. Anything removed
-- before submit, or abandoned with the form, became an orphaned storage
-- object nothing could find again. This table is the ledger for that gap:
-- every client upload records a row here immediately, the persisting server
-- action stamps `consumed_at` for the URLs it actually saved, and a GC job
-- (src/app/api/jobs/media-gc/route.ts) reaps rows still unconsumed after 48h
-- along with their storage objects.
--
-- `path` is unique because one storage object is one staged fact — re-upload
-- always mints a fresh uuid path, so a conflict means a replayed request.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

create table if not exists public.staged_uploads (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  bucket      text not null,
  path        text not null unique,
  url         text not null,
  created_at  timestamptz default now(),
  consumed_at timestamptz
);

comment on table public.staged_uploads is
  'Client-side storage uploads awaiting a DB reference. consumed_at is stamped when the URL is persisted; rows unconsumed after 48h are GC''d with their objects.';

-- Owner lookups (finalize by url set, per-user sweeps) and the GC scan.
create index if not exists staged_uploads_owner_created_idx
  on public.staged_uploads (owner_id, created_at);
create index if not exists staged_uploads_unconsumed_created_idx
  on public.staged_uploads (created_at)
  where consumed_at is null;

alter table public.staged_uploads enable row level security;

-- Owners manage their own staging rows; admins get full visibility for
-- support. The GC job runs service-role and bypasses RLS entirely.
drop policy if exists "owners insert staged uploads" on public.staged_uploads;
create policy "owners insert staged uploads" on public.staged_uploads
  for insert with check (owner_id = auth.uid());

drop policy if exists "owners read staged uploads" on public.staged_uploads;
create policy "owners read staged uploads" on public.staged_uploads
  for select using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "owners update staged uploads" on public.staged_uploads;
create policy "owners update staged uploads" on public.staged_uploads
  for update using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists "owners delete staged uploads" on public.staged_uploads;
create policy "owners delete staged uploads" on public.staged_uploads
  for delete using (owner_id = auth.uid() or public.is_admin());

grant select, insert, update, delete on public.staged_uploads to authenticated;
revoke all on public.staged_uploads from anon;

-- ============================================================
-- Self-checks
-- ============================================================
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'staged_uploads'
  ) then
    raise exception 'SELF-CHECK FAILED: staged_uploads missing';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'staged_uploads_unconsumed_created_idx'
  ) then
    raise exception 'SELF-CHECK FAILED: staged_uploads GC index missing';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'staged_uploads') < 4 then
    raise exception 'SELF-CHECK FAILED: staged_uploads policies missing';
  end if;
end;
$$;

commit;
