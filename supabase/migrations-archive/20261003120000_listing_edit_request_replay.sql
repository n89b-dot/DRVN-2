-- 20261003120000 — a listing edit that committed can be recovered, not
-- mistaken for a conflict (R2-01, follows RR-05).
--
-- update_listing_atomic (20261001120000) made an edit all-or-nothing, but an
-- edit had no identity. When the database committed and the answer was lost
-- on the way back (a dropped connection, a timed-out Server Action), the
-- seller saw "nothing was changed"; retrying the same edit then hit the
-- stale-version check, because the first attempt had already moved the
-- version on. Their own unacknowledged save and somebody else's competing
-- edit looked the same.
--
-- Now each edit carries a request id that the form keeps until the outcome
-- is known, bound to the listing, the version the edit started from and a
-- hash of its normalized payload. save_listing_edit records the committed
-- outcome in the same transaction as the edit:
--   * an exact replay (same request, listing, version and payload) returns
--     the recorded outcome without writing anything again;
--   * the same request id with anything different is refused (22023);
--   * a different request starting from an old version is still a conflict
--     (40001) — the version check is not weakened;
--   * ownership and suspension are rechecked on every replay.
-- listing_edit_status answers "did request X commit?" without writing, so
-- the editor can reconcile an unknown outcome read-only.
--
-- The ledger is private, like listing_creation_requests (20260905233517):
-- callers reach it only through the narrow definer functions below, which
-- act on the caller's own rows. Rows are trimmed after seven days — long
-- after any form could still be waiting on an answer.
-- Additive; update_listing_atomic is unchanged and still does the edit.

begin;

create table if not exists private.listing_edit_requests (
  seller_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  listing_id uuid not null references public.listings(id) on delete cascade,
  expected_updated_at timestamptz not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (seller_id, request_id)
);
create index if not exists listing_edit_requests_age_idx
  on private.listing_edit_requests (seller_id, created_at);

alter table private.listing_edit_requests enable row level security;
revoke all on private.listing_edit_requests from public, anon, authenticated;

-- The recorded outcome of the caller's request, or null if it never
-- committed. Raises 22023 when the request id was used for a different edit.
create or replace function public.replay_listing_edit(
  p_request uuid,
  p_payload_hash text,
  p_listing uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_request private.listing_edit_requests%rowtype;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_request is null or coalesce(p_payload_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid listing edit request' using errcode = '22023';
  end if;
  select * into v_request
  from private.listing_edit_requests r
  where r.seller_id = v_actor and r.request_id = p_request;
  if not found then return null; end if;
  if v_request.listing_id is distinct from p_listing
     or v_request.expected_updated_at is distinct from p_expected_updated_at
     or v_request.payload_hash is distinct from p_payload_hash then
    raise exception 'This edit request was already used with different details'
      using errcode = '22023';
  end if;
  -- A replay is not a free pass: the caller must still own the listing and
  -- be allowed to act.
  if not exists (select 1 from public.listings l where l.id = p_listing and l.seller_id = v_actor) then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;
  if public.is_suspended(v_actor) then
    raise exception 'account is suspended' using errcode = '42501';
  end if;
  return v_request.result;
end;
$$;

-- Records a committed edit. Only callable for the caller's own listing, and
-- only while the listing is at exactly the version the edit produced — i.e.
-- inside the edit's own transaction.
create or replace function public.record_listing_edit(
  p_request uuid,
  p_payload_hash text,
  p_listing uuid,
  p_expected_updated_at timestamptz,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_inserted integer;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_request is null or coalesce(p_payload_hash, '') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_result) is distinct from 'object' then
    raise exception 'Invalid listing edit request' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.listings l
    where l.id = p_listing and l.seller_id = v_actor
      and l.updated_at = (p_result->>'updated_at')::timestamptz
  ) then
    raise exception 'Edit outcome does not match the listing' using errcode = '22023';
  end if;

  delete from private.listing_edit_requests r
  where r.seller_id = v_actor and r.created_at < now() - interval '7 days';

  insert into private.listing_edit_requests(
    seller_id, request_id, listing_id, expected_updated_at, payload_hash, result
  ) values (v_actor, p_request, p_listing, p_expected_updated_at, p_payload_hash, p_result)
  on conflict (seller_id, request_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'This edit request was already used' using errcode = '22023';
  end if;
end;
$$;

-- Read-only: did the caller's request commit, and with what outcome?
create or replace function public.listing_edit_status(p_request uuid, p_listing uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select r.result into v_result
  from private.listing_edit_requests r
  join public.listings l on l.id = r.listing_id and l.seller_id = v_actor
  where r.seller_id = v_actor and r.request_id = p_request and r.listing_id = p_listing;
  if not found then return jsonb_build_object('committed', false); end if;
  return jsonb_build_object('committed', true, 'result', v_result);
end;
$$;

-- The edit itself. SECURITY INVOKER like update_listing_atomic, which it
-- calls: the seller's RLS and every listings trigger still apply. The
-- advisory lock serializes concurrent deliveries of the same request, so a
-- double click or a retry racing the original can't both edit.
create or replace function public.save_listing_edit(
  p_request uuid,
  p_payload_hash text,
  p_listing uuid,
  p_expected_updated_at timestamptz,
  p_fields jsonb,
  p_images jsonb,
  p_fitments jsonb,
  p_alt_numbers jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_prior jsonb;
  v_saved jsonb;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('listing-edit:' || v_actor::text || ':' || p_request::text, 0));

  v_prior := public.replay_listing_edit(p_request, p_payload_hash, p_listing, p_expected_updated_at);
  if v_prior is not null then
    return v_prior || jsonb_build_object('replayed', true);
  end if;

  v_saved := public.update_listing_atomic(
    p_listing, p_expected_updated_at, p_fields, p_images, p_fitments, p_alt_numbers
  );
  perform public.record_listing_edit(
    p_request, p_payload_hash, p_listing, p_expected_updated_at, v_saved
  );
  return v_saved || jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.replay_listing_edit(uuid, text, uuid, timestamptz) from public, anon;
revoke all on function public.record_listing_edit(uuid, text, uuid, timestamptz, jsonb) from public, anon;
revoke all on function public.listing_edit_status(uuid, uuid) from public, anon;
revoke all on function public.save_listing_edit(uuid, text, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.replay_listing_edit(uuid, text, uuid, timestamptz) to authenticated;
grant execute on function public.record_listing_edit(uuid, text, uuid, timestamptz, jsonb) to authenticated;
grant execute on function public.listing_edit_status(uuid, uuid) to authenticated;
grant execute on function public.save_listing_edit(uuid, text, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
