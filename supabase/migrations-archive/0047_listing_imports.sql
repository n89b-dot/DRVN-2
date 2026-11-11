-- 0047 — listing imports (Existing Listing Importer).
--
-- A seller who already posted a part somewhere else (a forum thread, Facebook
-- Marketplace, a classifieds page) brings it to DRVN by pasting the URL or the
-- post text. The import is a durable, resumable job: each row IS the state
-- machine (status column), advanced one bounded step at a time by server
-- actions, polled by the UI. Nothing here writes a listing — a `ready` import
-- only ever prefills the existing sell form, and the normal createListing
-- action stamps it `consumed`.
--
-- Retention posture: `normalized_source` can carry personal residue from the
-- source post (phone numbers, handles). The /api/jobs/listing-imports sweep
-- expires unconsumed imports after `expires_at` (48h, matching the staged
-- media lifecycle from 0029) and clears source/extraction payloads from
-- terminal rows, so DRVN never accumulates an archive of external pages.
--
-- Idempotent. Safe to re-run.

begin;

create table if not exists public.listing_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,

  -- How the source material arrived. 'url' may still carry pasted text later:
  -- a blocked fetch falls forward to paste WITHOUT losing URL provenance.
  source_mode text not null check (source_mode in ('url', 'paste')),
  -- Which adapter claimed the URL (facebook, discourse, xenforo, vbulletin,
  -- phpbb, generic, paste). Denormalized for analytics + debugging.
  source_adapter text,

  source_url text check (char_length(source_url) <= 2048),
  canonical_url text check (char_length(canonical_url) <= 2048),
  source_domain text check (char_length(source_domain) <= 255),

  -- The durable state machine. Transitions are guarded below and mirrored in
  -- src/lib/domain/states.ts (IMPORT_TRANSITIONS).
  status text not null default 'pending'
    check (status in (
      'pending',          -- created, no work started
      'fetching',         -- retrieving + normalizing the source page
      'extracting',       -- AI normalization into the listing shape
      'importing_media',  -- downloading + re-hosting source photos
      'ready',            -- reviewable — prefills the sell form
      'failed',           -- a step failed; retryable
      'consumed',         -- became a listing (terminal)
      'expired'           -- swept before consumption (terminal)
    )),

  attempts int not null default 0 check (attempts >= 0 and attempts <= 50),
  -- Step lease (the 0026 worker idiom, single-column form): a poll may only
  -- run a step after claiming an unexpired lease, so two concurrent polls
  -- never double-run work. Cleared on every completed transition.
  lease_expires_at timestamptz,

  -- One DRVN-owned shape per stage; adapters converge into normalized_source
  -- before AI runs, extraction output is server-validated before storage.
  normalized_source jsonb,
  extracted jsonb,
  -- Photos already re-hosted into the seller's own storage, in source order.
  imported_images jsonb,
  -- Which item of a multi-item ("part-out") post the seller chose.
  selected_item int check (selected_item >= 0 and selected_item < 50),

  error_code text check (char_length(error_code) <= 64),
  error_detail text check (char_length(error_detail) <= 2000),

  listing_id uuid references public.listings (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  consumed_at timestamptz,
  -- Aligned with the 48h staged-media lifecycle (0029): an import nobody
  -- finishes expires alongside the staged photos it produced.
  expires_at timestamptz not null default (now() + interval '48 hours')
);

create index if not exists listing_imports_user_idx
  on public.listing_imports (user_id, created_at desc);
create index if not exists listing_imports_status_idx
  on public.listing_imports (status, updated_at);
create index if not exists listing_imports_expiry_idx
  on public.listing_imports (expires_at)
  where status not in ('consumed', 'expired');

-- Same-seller dedupe: one live import per canonical URL. A re-paste resumes
-- the existing import instead of re-fetching and re-paying for extraction.
create unique index if not exists listing_imports_active_url_idx
  on public.listing_imports (user_id, canonical_url)
  where canonical_url is not null
    and status in ('pending', 'fetching', 'extracting', 'importing_media', 'ready');

-- Bounded per user: like saved searches (0044), enforced with a trigger
-- because a CHECK can't count rows. 20 non-terminal imports is far above any
-- honest use and keeps a scripted client from queueing unbounded fetch work.
create or replace function public.guard_listing_import_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.listing_imports
      where user_id = new.user_id
        and status not in ('consumed', 'expired', 'failed')) >= 20 then
    raise exception 'listing import limit reached (20 in progress)';
  end if;
  return new;
end;
$$;
drop trigger if exists listing_imports_count_guard on public.listing_imports;
create trigger listing_imports_count_guard
  before insert on public.listing_imports
  for each row execute function public.guard_listing_import_count();

-- Status transition guard — the DB stays the authority on legal moves, the
-- same stance as orders/offers (0007/0012). Mirrored for developer clarity in
-- src/lib/domain/states.ts; a divergence between the two is a bug there.
create or replace function public.guard_listing_import_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'pending'         and new.status in ('fetching', 'extracting', 'failed', 'expired')) or
    (old.status = 'fetching'        and new.status in ('extracting', 'failed', 'expired')) or
    (old.status = 'extracting'      and new.status in ('importing_media', 'ready', 'failed', 'expired')) or
    (old.status = 'importing_media' and new.status in ('ready', 'failed', 'expired')) or
    (old.status = 'ready'           and new.status in ('consumed', 'extracting', 'expired')) or
    (old.status = 'failed'          and new.status in ('fetching', 'extracting', 'expired'))
  ) then
    raise exception 'illegal listing import transition: % -> %', old.status, new.status;
  end if;
  -- consumed must point at the listing it became; nothing else may.
  if new.status = 'consumed' and new.listing_id is null then
    raise exception 'a consumed import must reference its listing';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists listing_imports_status_guard on public.listing_imports;
create trigger listing_imports_status_guard
  before update on public.listing_imports
  for each row execute function public.guard_listing_import_status();

alter table public.listing_imports enable row level security;
drop policy if exists "own listing imports" on public.listing_imports;
create policy "own listing imports" on public.listing_imports
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.listing_imports to authenticated;
revoke all on public.listing_imports from anon;

-- One-time content-rights acknowledgement for the importer ("this is my own
-- post and my own part") — account-level, asked once, not per import.
alter table public.profiles
  add column if not exists import_attested_at timestamptz;

-- 0017 replaced profiles' table-wide privileges with explicit column lists,
-- so a new self-service column must be granted or every read/write of it is
-- "permission denied". The attestation is the account holder's own claim:
-- readable and settable by them, nothing sensitive.
grant select (import_attested_at) on public.profiles to authenticated;
grant update (import_attested_at) on public.profiles to authenticated;

-- ============================================================
-- Self-checks
-- ============================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count from information_schema.tables
    where table_schema = 'public' and table_name = 'listing_imports';
  if v_count <> 1 then
    raise exception 'FAIL: listing_imports table missing';
  end if;

  select count(*) into v_count from pg_policies
    where schemaname = 'public' and tablename = 'listing_imports';
  if v_count < 1 then
    raise exception 'FAIL: listing_imports has no RLS policies';
  end if;

  select count(*) into v_count from pg_trigger
    where tgname in ('listing_imports_status_guard', 'listing_imports_count_guard');
  if v_count <> 2 then
    raise exception 'FAIL: listing_imports guard triggers missing';
  end if;

  select count(*) into v_count from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'import_attested_at';
  if v_count <> 1 then
    raise exception 'FAIL: profiles.import_attested_at missing';
  end if;

  raise notice 'PASS: 0047 self-checks';
end $$;

commit;
