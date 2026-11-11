-- ============================================================================
-- 20261110100000 — one signed URL per photo per window, across instances
-- (report five #117, #105)
--
-- src/lib/supabase/photo-signing.ts signs member photos once per hour-long
-- window and kept the result in process memory. On a serverless host every
-- instance minted its own URL for the same photo, so the image optimiser saw
-- a new source per instance, per width, per hour: cache misses, billed
-- transformations, and browser caches that missed between pages.
--
-- This is the shared memo: the first instance to sign a photo in a window
-- offers its URL, later offers lose, and every instance reads the winner.
-- A signed URL is a bearer link to a private object for up to two hours, so
-- the table lives in `private`, readable only through these two definer
-- functions, executable only by the service role (the signer's own client).
--
-- Rows older than the previous window are deleted as offers arrive, a bounded
-- batch at a time, and daily by drvn-cron-history-prune; a deleted member's
-- rows go when their scrub runs. The table holds about two windows of photos.
--
-- Idempotent.
-- ============================================================================

begin;

create table if not exists private.photo_signatures (
  bucket text not null check (bucket in ('car-images', 'listing-images', 'activity-images')),
  path text not null check (length(path) between 3 and 512),
  signing_window bigint not null,
  signed_url text not null,
  created_at timestamptz not null default now(),
  primary key (bucket, path, signing_window)
);
create index if not exists photo_signatures_window_idx on private.photo_signatures (signing_window);

alter table private.photo_signatures enable row level security;
revoke all on table private.photo_signatures from public, anon, authenticated;

comment on table private.photo_signatures is
  'The signed URL each member photo is shown through in one signing window, shared by every app instance (20261110100000). Bearer links: service role only, through photo_signatures_read/offer.';

-- The winners already known for these objects in this window.
create or replace function public.photo_signatures_read(p_window bigint, p_objects jsonb)
returns table (bucket text, path text, signed_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.bucket, s.path, s.signed_url
    from jsonb_to_recordset(coalesce(p_objects, '[]'::jsonb)) as o(bucket text, path text)
    join private.photo_signatures s
      on s.bucket = o.bucket and s.path = o.path and s.signing_window = p_window;
$$;

-- Offer freshly minted URLs; the first offer for an object in a window wins,
-- and every caller gets the winners back.
create or replace function public.photo_signatures_offer(p_window bigint, p_signed jsonb)
returns table (bucket text, path text, signed_url text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- In key order, so two instances offering overlapping photos in different
  -- orders take the keys in the same order and never deadlock. Paths the
  -- table would refuse are left out, so one bad path can't fail the batch.
  insert into private.photo_signatures (bucket, path, signing_window, signed_url)
  select distinct on (o.bucket, o.path) o.bucket, o.path, p_window, o.signed_url
    from jsonb_to_recordset(coalesce(p_signed, '[]'::jsonb)) as o(bucket text, path text, signed_url text)
   where o.bucket in ('car-images', 'listing-images', 'activity-images')
     and o.path is not null and length(o.path) between 3 and 512 and o.signed_url is not null
   order by o.bucket, o.path
  on conflict on constraint photo_signatures_pkey do nothing;

  -- Windows before the previous one can never be served again. Rows another
  -- offer is already removing are skipped, not waited for.
  delete from private.photo_signatures d
   where d.ctid in (
     select x.ctid from private.photo_signatures x
      where x.signing_window < p_window - 1
      limit 1000
      for update skip locked
   );

  return query
  select s.bucket, s.path, s.signed_url
    from jsonb_to_recordset(coalesce(p_signed, '[]'::jsonb)) as o(bucket text, path text)
    join private.photo_signatures s
      on s.bucket = o.bucket and s.path = o.path and s.signing_window = p_window;
end;
$$;

-- The daily clean-up (drvn-cron-history-prune, an existing job) also drops
-- every row older than the previous window, so paths (which name their
-- owner) don't sit at rest when no offers arrive. From 20261107191000, with
-- that one delete added; the job's command is unchanged.
create or replace function private.prune_cron_history()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '14 days';
  get diagnostics removed = row_count;
  -- Rows an offer is writing right now are skipped, not waited for.
  delete from private.photo_signatures d
   where d.ctid in (select x.ctid from private.photo_signatures x
                     where x.created_at < now() - interval '2 hours'
                     for update skip locked);
  return removed;
end;
$$;
revoke all on function private.prune_cron_history() from public, anon, authenticated;

-- A deleted account's signed links go with its personal data: when the
-- deletion scrub records scrubbed_at, every row under that member's folders
-- is removed.
create or replace function private.photo_signatures_forget_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.user_id is not null and new.scrubbed_at is not null and old.scrubbed_at is null then
    -- Locked in key order, the order offers take, so this can never
    -- deadlock with one and abort the scrub.
    delete from private.photo_signatures d
     where d.ctid in (select x.ctid from private.photo_signatures x
                       where split_part(x.path, '/', 1) = new.user_id::text
                       order by x.bucket, x.path, x.signing_window
                       for update);
  end if;
  return new;
end;
$$;
revoke all on function private.photo_signatures_forget_member() from public, anon, authenticated;
drop trigger if exists photo_signatures_forget_member on public.account_deletion_requests;
create trigger photo_signatures_forget_member
  after update of scrubbed_at on public.account_deletion_requests
  for each row execute function private.photo_signatures_forget_member();

revoke all on function public.photo_signatures_read(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.photo_signatures_offer(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.photo_signatures_read(bigint, jsonb) to service_role;
grant execute on function public.photo_signatures_offer(bigint, jsonb) to service_role;

do $$
begin
  if to_regclass('private.photo_signatures') is null then
    raise exception '20261110100000: private.photo_signatures missing';
  end if;
  if has_function_privilege('anon', 'public.photo_signatures_read(bigint, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.photo_signatures_offer(bigint, jsonb)', 'execute') then
    raise exception '20261110100000: photo signatures are callable by a member';
  end if;
  raise notice 'PASS: 20261110100000 self-checks';
end $$;

commit;
