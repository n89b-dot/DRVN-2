-- 20261108120010 — N627: photos stored before metadata stripping lose it.
--
-- Message photos went into the private message-photos bucket straight from
-- the browser until 20261005100000 made the server re-encode the only way in;
-- a photo sent before then may still carry EXIF/GPS (a photo taken at home
-- hands its recipient the address). New uploads are clean. This is the
-- database half of a one-off, resumable owner job
-- (scripts/owner/scrub-photo-metadata.mjs) that re-encodes, in place, every
-- stored message and chat photo that still has metadata.
--
-- The job works one object at a time under the same per-object lock as
-- media cleanup (20261107203000 §7, `drvn-media:<bucket>/<path>`):
--
--   * claim_photo_rewrite takes a short lease on the object. It refuses an
--     object a remover has claimed (active: busy; deleted: gone) and one
--     Storage no longer holds.
--   * claim_media_deletion (restated) answers 'busy' while a rewrite lease
--     is live, so cleanup never deletes an object mid-rewrite, and a rewrite
--     never starts on one being deleted. The chat sweep
--     (agent_chat_photos_expired, restated) skips a photo mid-rewrite too.
--   * The write is fenced on the object's identity (storage.objects.id).
--     Storage's write always upserts, so a write after a deletion would
--     recreate the photo; clearing a chat and account deletion delete at
--     once and never wait for this job. A recreated object has a new id:
--     finish_photo_rewrite answers 'recreated' and the job deletes it, and
--     the lease keeps the old id so a run that died first is caught by the
--     next claim of that path. A tombstone never hides a live object:
--     photo_rewrite_strays lists unfinished leases and tombstoned paths with
--     an object again, every run deletes those before its scan, and a claim
--     of a tombstoned path that has an object answers 'recreated'.
--   * finish_photo_rewrite releases the lease (only with its token) and
--     records the outcome in private.photo_metadata_scrubs, with the object's
--     version at that moment. photo_metadata_candidates skips an object whose
--     recorded version is current, so a rerun resumes where the last stopped
--     and a re-encoded object is never re-encoded again.
--
-- Dispute evidence is deliberately not touched: it is kept exactly as
-- uploaded, as a record (docs/remediation-data-inventory.md). The public
-- buckets have their own backfill (scripts/public-media-backfill.mjs).
--
-- Owns: claim_media_deletion (restated from 20261107203000, its only
-- definition, with the rewrite-lease check added), agent_chat_photos_expired
-- (restated from 20261107220300, its only definition, same addition), and the
-- new objects below.

begin;

-- ---------- 1. Leases and the ledger ----------
create table if not exists private.media_rewrite_claims (
  bucket     text not null,
  path       text not null,
  token      uuid not null,
  -- storage.objects.id when claimed: the write fence (section 3).
  object_id  uuid not null,
  claimed_at timestamptz not null default now(),
  primary key (bucket, path)
);
revoke all on private.media_rewrite_claims from public, anon, authenticated;

create table if not exists private.photo_metadata_scrubs (
  bucket            text not null,
  path              text not null,
  -- clean: no metadata found. scrubbed: re-encoded without it. skipped: a
  -- format the job won't re-encode (reported for a person). failed: retried
  -- by the next run.
  outcome           text not null check (outcome in ('clean', 'scrubbed', 'skipped', 'failed')),
  detail            text check (detail is null or length(detail) <= 500),
  -- storage.objects.updated_at when the outcome was recorded: a later
  -- version of the object is checked again.
  object_updated_at timestamptz,
  checked_at        timestamptz not null default now(),
  primary key (bucket, path)
);
revoke all on private.photo_metadata_scrubs from public, anon, authenticated;

-- The private photo buckets this job may rewrite.
create or replace function private.photo_scrub_bucket(p_bucket text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select p_bucket in ('message-photos', 'agent-chat-photos');
$$;
revoke all on function private.photo_scrub_bucket(text) from public, anon, authenticated;

-- ---------- 2. Candidates: stored objects not yet settled ----------
-- Keyset by name (p_after), so a run pages through a bucket and a rerun
-- resumes; settled objects (clean, scrubbed, skipped at their current
-- version) and objects a remover has claimed are left out.
create or replace function public.photo_metadata_candidates(
  p_bucket text,
  p_after text default null,
  p_limit integer default 100,
  p_uploaded_before timestamptz default null
)
returns table(path text, updated_at timestamptz, size_bytes bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(private.photo_scrub_bucket(p_bucket), false) then
    raise exception 'Not a photo bucket this job rewrites: %', p_bucket using errcode = '22023';
  end if;
  return query
  select o.name::text, o.updated_at, coalesce((o.metadata->>'size')::bigint, 0)
    from storage.objects o
   where o.bucket_id = p_bucket
     and (p_after is null or o.name > p_after)
     and (p_uploaded_before is null or o.created_at < p_uploaded_before)
     and not exists (select 1 from private.photo_metadata_scrubs s
                      where s.bucket = p_bucket and s.path = o.name
                        and s.outcome in ('clean', 'scrubbed', 'skipped')
                        and s.object_updated_at is not distinct from o.updated_at)
     and not exists (select 1 from private.media_deletion_claims c
                      where c.bucket = p_bucket and c.path = o.name)
   order by o.name
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;
revoke all on function public.photo_metadata_candidates(text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.photo_metadata_candidates(text, text, integer, timestamptz) to service_role;

-- ---------- 3. The rewrite lease, and the write fence ----------
-- Storage's write (PUT, and upload with upsert) always upserts: if a remover
-- deletes the object after the job read it, the job's write would create it
-- again. Some removers (the chat sweep, clearing a chat, account deletion)
-- delete straight through Storage, and must never wait on this job. So the
-- write is fenced on the object's identity instead: the lease records
-- storage.objects.id. Writing over a live object keeps its row (Storage
-- merges into it on conflict) and so its id; a write that recreated a
-- deleted object makes a new row with a new id. finish_photo_rewrite
-- compares them and answers 'recreated', and the job deletes what it
-- recreated. If the job dies first, the lease outlives it with the old id,
-- and the next claim of that path answers 'recreated' too.
--
-- claim_photo_rewrite: {"status": "claimed", "token", "object_id"} —
-- download, re-encode, check_photo_rewrite, write, finish; "recreated"
-- (with a token) — delete the object, then finish; "busy" — a remover or
-- another rewrite holds it; "gone" — deleted, being deleted, or not in
-- Storage; "invalid" — not an object this job rewrites.
create or replace function public.claim_photo_rewrite(p_bucket text, p_path text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_deletion private.media_deletion_claims%rowtype;
  v_lease private.media_rewrite_claims%rowtype;
  v_object uuid;
  v_token uuid := gen_random_uuid();
begin
  if not coalesce(private.photo_scrub_bucket(p_bucket), false) or not coalesce(private.media_path_ok(p_path), false) then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('drvn-media:' || p_bucket || '/' || p_path, 0));
  select * into v_lease from private.media_rewrite_claims where bucket = p_bucket and path = p_path;
  if found and v_lease.claimed_at > now() - interval '10 minutes' then
    return jsonb_build_object('status', 'busy');
  end if;
  select o.id into v_object from storage.objects o where o.bucket_id = p_bucket and o.name = p_path;
  -- A lapsed lease whose object has another identity: an earlier run's write
  -- recreated a deleted photo and stopped before deleting it again.
  if v_lease.path is not null and v_object is not null and v_object <> v_lease.object_id then
    update private.media_rewrite_claims set token = v_token, claimed_at = now()
     where bucket = p_bucket and path = p_path;
    return jsonb_build_object('status', 'recreated', 'token', v_token, 'object_id', v_lease.object_id);
  end if;
  if v_object is null then
    delete from private.media_rewrite_claims where bucket = p_bucket and path = p_path;
    return jsonb_build_object('status', 'gone');
  end if;
  select * into v_deletion from private.media_deletion_claims where bucket = p_bucket and path = p_path;
  if found and v_deletion.state = 'done' then
    -- A tombstone never hides a live object: the cleanup deleted this path
    -- for good (and no reference may name it again), so an object here
    -- exists only because a late write recreated it. The job deletes it.
    insert into private.media_rewrite_claims (bucket, path, token, object_id, claimed_at)
    values (p_bucket, p_path, v_token, v_object, now())
    on conflict (bucket, path) do update set token = excluded.token, claimed_at = excluded.claimed_at;
    return jsonb_build_object('status', 'recreated', 'token', v_token,
                              'object_id', coalesce(v_lease.object_id, v_object));
  end if;
  if found then
    return jsonb_build_object('status', 'busy');
  end if;
  insert into private.media_rewrite_claims (bucket, path, token, object_id, claimed_at)
  values (p_bucket, p_path, v_token, v_object, now())
  on conflict (bucket, path) do update
    set token = excluded.token, object_id = excluded.object_id, claimed_at = excluded.claimed_at;
  return jsonb_build_object('status', 'claimed', 'token', v_token, 'object_id', v_object);
end;
$$;
revoke all on function public.claim_photo_rewrite(text, text) from public, anon, authenticated;
grant execute on function public.claim_photo_rewrite(text, text) to service_role;

-- Just before the write: is the lease still this job's, and the object the
-- one it read? 'current' — write; 'gone' — deleted meanwhile, don't write;
-- 'lost' — the lease lapsed or the object changed, don't write.
create or replace function public.check_photo_rewrite(p_bucket text, p_path text, p_token uuid, p_object uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_object uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('drvn-media:' || p_bucket || '/' || p_path, 0));
  select o.id into v_object from storage.objects o where o.bucket_id = p_bucket and o.name = p_path;
  if v_object is null
     or exists (select 1 from private.media_deletion_claims c where c.bucket = p_bucket and c.path = p_path) then
    return 'gone';
  end if;
  if v_object <> p_object or not exists (
    select 1 from private.media_rewrite_claims r
     where r.bucket = p_bucket and r.path = p_path and r.token = p_token
       and r.claimed_at > now() - interval '10 minutes') then
    return 'lost';
  end if;
  return 'current';
end;
$$;
revoke all on function public.check_photo_rewrite(text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.check_photo_rewrite(text, text, uuid, uuid) to service_role;

-- What the job checks before every run's scan (N627 fix-check): an unfinished
-- lease past its 10 minutes (a run that died, perhaps after a write that
-- recreated a deleted photo), and a tombstoned path that has an object again
-- (a late write landed after the cleanup). The candidate scan leaves both out,
-- so without this a recreated photo would never be deleted again.
create or replace function public.photo_rewrite_strays(p_bucket text, p_limit integer default 500)
returns table(path text, reason text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.path, min(s.reason)
    from (
      select r.path, 'unfinished_lease' as reason
        from private.media_rewrite_claims r
       where r.bucket = p_bucket and r.claimed_at <= now() - interval '10 minutes'
      union all
      select c.path, 'tombstoned_object'
        from private.media_deletion_claims c
        join storage.objects o on o.bucket_id = c.bucket and o.name = c.path
       where c.bucket = p_bucket and c.state = 'done'
    ) s
   where private.photo_scrub_bucket(p_bucket)
   group by s.path
   order by s.path
   limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;
revoke all on function public.photo_rewrite_strays(text, integer) from public, anon, authenticated;
grant execute on function public.photo_rewrite_strays(text, integer) to service_role;

-- After the write (or instead of one). p_object is the identity the claim
-- returned. Answers:
--   'recorded'  — the object is the one claimed: outcome recorded, lease released;
--   'gone'      — no object any more (deleted after the write, or the job
--                 deleted what it recreated): lease released, nothing recorded;
--   'recreated' — the object has a new identity: the write recreated a
--                 deleted photo. The lease is kept (and renewed); the job
--                 deletes the object and calls this again;
--   'lease_lost'— the object is the one claimed but the lease isn't this
--                 job's any more; nothing recorded, the next run checks again.
create or replace function public.finish_photo_rewrite(
  p_bucket text,
  p_path text,
  p_token uuid,
  p_object uuid,
  p_outcome text,
  p_detail text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_object uuid;
  v_updated timestamptz;
begin
  if p_outcome is null or p_outcome not in ('clean', 'scrubbed', 'skipped', 'failed') then
    raise exception 'Unknown rewrite outcome %', p_outcome using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('drvn-media:' || p_bucket || '/' || p_path, 0));
  select o.id, o.updated_at into v_object, v_updated from storage.objects o where o.bucket_id = p_bucket and o.name = p_path;
  if v_object is null then
    delete from private.media_rewrite_claims where bucket = p_bucket and path = p_path and token = p_token;
    return 'gone';
  end if;
  if v_object <> p_object then
    -- Whoever holds the lease now, this object exists only because a write
    -- recreated it. Keep the lease (with the original identity) so the
    -- media cleanup leaves it alone and a later claim knows what it is.
    update private.media_rewrite_claims set claimed_at = now()
     where bucket = p_bucket and path = p_path and token = p_token;
    return 'recreated';
  end if;
  delete from private.media_rewrite_claims where bucket = p_bucket and path = p_path and token = p_token;
  if not found then
    return 'lease_lost';
  end if;
  insert into private.photo_metadata_scrubs (bucket, path, outcome, detail, object_updated_at, checked_at)
  values (p_bucket, p_path, p_outcome, left(p_detail, 500), v_updated, now())
  on conflict (bucket, path) do update
    set outcome = excluded.outcome, detail = excluded.detail,
        object_updated_at = excluded.object_updated_at, checked_at = excluded.checked_at;
  return 'recorded';
end;
$$;
revoke all on function public.finish_photo_rewrite(text, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.finish_photo_rewrite(text, text, uuid, uuid, text, text) to service_role;

-- What the job has recorded so far, per bucket and outcome, for its report.
create or replace function public.photo_metadata_scrub_summary()
returns table(bucket text, outcome text, objects bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.bucket, s.outcome, count(*) from private.photo_metadata_scrubs s group by 1, 2 order by 1, 2;
$$;
revoke all on function public.photo_metadata_scrub_summary() from public, anon, authenticated;
grant execute on function public.photo_metadata_scrub_summary() to service_role;

-- ---------- 4. Cleanup waits for a live rewrite ----------
-- Restated from 20261107203000 (its only definition) with one addition: a
-- live rewrite lease on the object answers 'busy', like another remover.
create or replace function public.claim_media_deletion(p_bucket text, p_path text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim private.media_deletion_claims%rowtype;
  v_token uuid := gen_random_uuid();
begin
  if p_bucket is null or p_bucket !~ '^[a-z0-9_-]{1,63}$' or not coalesce(private.media_path_ok(p_path), false) then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('drvn-media:' || p_bucket || '/' || p_path, 0));
  select * into v_claim from private.media_deletion_claims where bucket = p_bucket and path = p_path;
  if found and v_claim.state = 'done' then
    return jsonb_build_object('status', 'gone');
  end if;
  if found and v_claim.claimed_at > now() - interval '10 minutes' then
    return jsonb_build_object('status', 'busy');
  end if;
  -- N627: the metadata job is re-encoding this object right now.
  if exists (select 1 from private.media_rewrite_claims r
              where r.bucket = p_bucket and r.path = p_path and r.claimed_at > now() - interval '10 minutes') then
    return jsonb_build_object('status', 'busy');
  end if;
  if found then
    -- Lease takeover. The previous holder neither completed nor released, so
    -- its delete may have happened: the claim stays and becomes uncertain
    -- (no reference could have been added while it was held).
    update private.media_deletion_claims
       set token = v_token, claimed_at = now(), maybe_deleted = true
     where bucket = p_bucket and path = p_path;
    return jsonb_build_object('status', 'claimed', 'token', v_token, 'maybe_deleted', true);
  end if;
  -- A fresh statement after the lock: it sees any reference committed by a
  -- writer that held the lock before us.
  if public.media_object_referenced(p_bucket, p_path) then
    return jsonb_build_object('status', 'referenced');
  end if;
  insert into private.media_deletion_claims (bucket, path, token, state, claimed_at)
    values (p_bucket, p_path, v_token, 'active', now());
  return jsonb_build_object('status', 'claimed', 'token', v_token, 'maybe_deleted', false);
end;
$$;
revoke all on function public.claim_media_deletion(text, text) from public, anon, authenticated;
grant execute on function public.claim_media_deletion(text, text) to service_role;

-- ---------- 5. Chat photo retention, in one place ----------
-- The privacy page's 48 hours. The sweep (agent_chat_photos_expired, called
-- by src/lib/agent/chat-photos.ts with no age of its own) and the storage
-- reference report (20261108120020) both read it from here.
create or replace function private.agent_chat_photo_retention()
returns interval
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select interval '48 hours';
$$;
revoke all on function private.agent_chat_photo_retention() from public, anon, authenticated;

-- How often the sweep runs: every pass of drvn-agent-worker (*/5 * * * *,
-- src/lib/job-inventory.ts; job-inventory.test.ts holds the two together).
create or replace function private.agent_chat_sweep_interval()
returns interval
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select interval '5 minutes';
$$;
revoke all on function private.agent_chat_sweep_interval() from public, anon, authenticated;

-- A chat photo dated p_at is one the sweep has deleted by now: at or past the
-- retention, and a sweep pass has come since. Anything younger that is
-- missing is a loss, not retention.
create or replace function private.agent_chat_photo_swept(p_at timestamptz)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select p_at is not null
     and p_at <= now() - private.agent_chat_photo_retention() - private.agent_chat_sweep_interval();
$$;
revoke all on function private.agent_chat_photo_swept(timestamptz) from public, anon, authenticated;

-- ---------- 6. The chat sweep skips a photo mid-rewrite ----------
-- Restated from 20261107220300 (its only definition) with two changes: its
-- default age is private.agent_chat_photo_retention() (still 48 hours), and a
-- photo under a live rewrite lease waits for the next sweep (every few
-- minutes), so the sweep and the rewrite don't meet. Clearing a chat and
-- account deletion delete at once and never wait; the write fence covers them.
create or replace function public.agent_chat_photos_expired(p_older_than interval default null, p_limit integer default 500)
returns table (name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'agent-chat-photos'
     and o.created_at < now() - greatest(coalesce(p_older_than, private.agent_chat_photo_retention()), interval '1 hour')
     and not exists (select 1 from private.media_rewrite_claims r
                      where r.bucket = 'agent-chat-photos' and r.path = o.name
                        and r.claimed_at > now() - interval '10 minutes')
   order by o.created_at
   limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

revoke all on function public.agent_chat_photos_expired(interval, integer) from public, anon, authenticated;
grant execute on function public.agent_chat_photos_expired(interval, integer) to service_role;

notify pgrst, 'reload schema';

commit;
