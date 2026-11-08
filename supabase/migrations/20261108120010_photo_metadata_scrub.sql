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
--     never starts on one being deleted. The rewrite itself replaces the
--     object with Storage's update, which fails on a missing object, so it can
--     never bring a deleted photo back.
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
-- definition, with the rewrite-lease check added), and the new objects below.

begin;

-- ---------- 1. Leases and the ledger ----------
create table if not exists private.media_rewrite_claims (
  bucket     text not null,
  path       text not null,
  token      uuid not null,
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

-- ---------- 3. The rewrite lease ----------
-- {"status": "claimed", "token": <uuid>} — download, re-encode, update, then
-- finish; "busy" — a remover or another rewrite holds it; "gone" — deleted
-- or being deleted for good; "invalid" — not an object this job rewrites.
create or replace function public.claim_photo_rewrite(p_bucket text, p_path text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_deletion private.media_deletion_claims%rowtype;
  v_token uuid := gen_random_uuid();
begin
  if not coalesce(private.photo_scrub_bucket(p_bucket), false) or not coalesce(private.media_path_ok(p_path), false) then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('drvn-media:' || p_bucket || '/' || p_path, 0));
  select * into v_deletion from private.media_deletion_claims where bucket = p_bucket and path = p_path;
  if found then
    return jsonb_build_object('status', case when v_deletion.state = 'done' then 'gone' else 'busy' end);
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_path) then
    return jsonb_build_object('status', 'gone');
  end if;
  if exists (select 1 from private.media_rewrite_claims r
              where r.bucket = p_bucket and r.path = p_path and r.claimed_at > now() - interval '10 minutes') then
    return jsonb_build_object('status', 'busy');
  end if;
  insert into private.media_rewrite_claims (bucket, path, token, claimed_at)
  values (p_bucket, p_path, v_token, now())
  on conflict (bucket, path) do update set token = excluded.token, claimed_at = excluded.claimed_at;
  return jsonb_build_object('status', 'claimed', 'token', v_token);
end;
$$;
revoke all on function public.claim_photo_rewrite(text, text) from public, anon, authenticated;
grant execute on function public.claim_photo_rewrite(text, text) to service_role;

-- Releases the lease (the holder's token only) and records the outcome.
-- False: the lease was lost (taken over after 10 minutes) and nothing was
-- recorded; the next run checks the object again.
create or replace function public.finish_photo_rewrite(
  p_bucket text,
  p_path text,
  p_token uuid,
  p_outcome text,
  p_detail text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_outcome is null or p_outcome not in ('clean', 'scrubbed', 'skipped', 'failed') then
    raise exception 'Unknown rewrite outcome %', p_outcome using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('drvn-media:' || p_bucket || '/' || p_path, 0));
  delete from private.media_rewrite_claims
   where bucket = p_bucket and path = p_path and token = p_token;
  if not found then
    return false;
  end if;
  insert into private.photo_metadata_scrubs (bucket, path, outcome, detail, object_updated_at, checked_at)
  values (p_bucket, p_path, p_outcome, left(p_detail, 500),
          (select o.updated_at from storage.objects o where o.bucket_id = p_bucket and o.name = p_path), now())
  on conflict (bucket, path) do update
    set outcome = excluded.outcome, detail = excluded.detail,
        object_updated_at = excluded.object_updated_at, checked_at = excluded.checked_at;
  return true;
end;
$$;
revoke all on function public.finish_photo_rewrite(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.finish_photo_rewrite(text, text, uuid, text, text) to service_role;

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

notify pgrst, 'reload schema';

commit;
