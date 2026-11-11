-- 20261007100300 — an edit's outcome can only be recorded by the edit.
--
-- record_listing_edit (20261003120000) is the ledger write behind lost-answer
-- recovery. Its comment says it is callable "only … inside the edit's own
-- transaction", but the only check was that the listing sits at the version
-- named in p_result — true whenever the listing is at rest. It is granted to
-- authenticated (save_listing_edit runs as the caller), so a seller could call
-- it directly and store any outcome they liked for a request id: a later save
-- with that id is answered from the forged row ("Listing updated." with no
-- edit), and its removed_image_urls were handed to the storage clean-up.
-- (That clean-up is owner-scoped as of this round, so the forged list could
-- only name the seller's own files — this closes the door itself.)
--
-- save_listing_edit now sets a transaction-local marker naming the request
-- just before it records, and clears it after; record_listing_edit refuses
-- without it. A client reaches the database only through the API, one
-- function call per transaction, and has no way to set a setting there, so
-- the marker can only come from save_listing_edit.
--
-- Both functions restated from 20261003120000 with only those lines added.
-- Grants unchanged. Idempotent.

begin;

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
  -- 20261007100300: only from inside save_listing_edit, in its transaction.
  if coalesce(current_setting('drvn.listing_edit_request', true), '') is distinct from p_request::text then
    raise exception 'An edit outcome is recorded only by the edit itself' using errcode = '42501';
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
  -- 20261007100300: the pass record_listing_edit asks for, held only for
  -- that one call.
  perform set_config('drvn.listing_edit_request', p_request::text, true);
  perform public.record_listing_edit(
    p_request, p_payload_hash, p_listing, p_expected_updated_at, v_saved
  );
  perform set_config('drvn.listing_edit_request', '', true);
  return v_saved || jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.record_listing_edit(uuid, text, uuid, timestamptz, jsonb) from public, anon;
revoke all on function public.save_listing_edit(uuid, text, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.record_listing_edit(uuid, text, uuid, timestamptz, jsonb) to authenticated;
grant execute on function public.save_listing_edit(uuid, text, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
