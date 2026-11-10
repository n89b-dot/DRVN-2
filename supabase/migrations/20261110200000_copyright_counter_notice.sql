-- ============================================================================
-- 20261110200000 — reinstate after a valid counter-notice (report five #109;
-- the reviewer's second review of #200)
--
-- A takedown could never be undone: notices moved only received → actioned
-- or rejected, and a listing a takedown removed is now held for good
-- (20261110120000). A process with no counter-notice path is a legal gap.
-- Two audited admin actions, each behind the takedown's own admin step-up:
--
--   * record_copyright_counter_notice: the member's counter-notice, as
--     received (their name, address, the statement that the removal was a
--     mistake or misidentification, consent to jurisdiction, signature, the
--     date it arrived). One per notice. An actioned notice only.
--   * reinstate_after_counter_notice: at least 14 days (ten business days)
--     after the counter-notice arrived, and only with the admin's note that
--     the claimant has not said they filed a court action. The notice becomes
--     'reinstated', so it no longer holds its listings
--     (private.copyright_listing_held reads actioned notices only); each
--     listing the takedown removed goes back to 'paused' for its seller to
--     re-publish; the notice's photos come off the blocklist. Photos the
--     media worker already deleted are gone: the seller uploads again.
--
-- The legal steps around it (sending the counter-notice to the claimant, the
-- 10–14 business day wait, a court action stopping it) are the owner's
-- process (Needs Neil); the database holds the record and the clock.
-- Idempotent.
-- ============================================================================

begin;

alter table public.copyright_notices drop constraint if exists copyright_notices_status_check;
alter table public.copyright_notices add constraint copyright_notices_status_check
  check (status in ('received', 'actioned', 'rejected', 'reinstated'));

create table if not exists public.copyright_counter_notices (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null unique references public.copyright_notices (id),
  member_name text not null check (length(btrim(member_name)) between 2 and 200),
  member_address text not null check (length(btrim(member_address)) between 5 and 1000),
  statement text not null check (length(btrim(statement)) between 10 and 4000),
  consents_to_jurisdiction boolean not null check (consents_to_jurisdiction),
  signature text not null check (length(btrim(signature)) between 2 and 200),
  received_at timestamptz not null,
  recorded_by uuid not null,
  created_at timestamptz not null default now(),
  check (received_at <= created_at + interval '1 minute')
);
alter table public.copyright_counter_notices enable row level security;
revoke all on table public.copyright_counter_notices from public, anon, authenticated;
grant select, insert on table public.copyright_counter_notices to service_role;
comment on table public.copyright_counter_notices is
  'Counter-notices to copyright takedowns (20261110200000, #109). Holds the member''s contact details: never public. Admins act through the RPCs.';

create or replace function public.record_copyright_counter_notice(
  p_notice uuid, p_member_name text, p_member_address text, p_statement text,
  p_consents boolean, p_signature text, p_received_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.copyright_admin_step_up();
  v_id uuid;
begin
  perform 1 from public.copyright_notices where id = p_notice and status = 'actioned' for update;
  if not found then raise exception 'Only a notice that was acted on can have a counter-notice' using errcode = '55000'; end if;
  if p_received_at is null or p_received_at > now() then raise exception 'When the counter-notice arrived is required, and not in the future' using errcode = '22023'; end if;
  if not coalesce(p_consents, false) then raise exception 'A counter-notice must consent to jurisdiction' using errcode = '22023'; end if;
  insert into public.copyright_counter_notices (notice_id, member_name, member_address, statement, consents_to_jurisdiction, signature, received_at, recorded_by)
  values (p_notice, btrim(p_member_name), btrim(p_member_address), btrim(p_statement), true, btrim(p_signature), p_received_at, v_actor)
  returning id into v_id;
  insert into public.admin_audit_log (actor_id, action, subject_type, subject_id, reason, metadata)
  values (v_actor, 'copyright.counter_notice', 'copyright_notice', p_notice, 'Counter-notice recorded',
          jsonb_build_object('phase', 'completed', 'counterNoticeId', v_id, 'receivedAt', p_received_at));
  return v_id;
exception when unique_violation then
  raise exception 'This notice already has a counter-notice' using errcode = '23505';
end;
$$;
revoke all on function public.record_copyright_counter_notice(uuid, text, text, text, boolean, text, timestamptz) from public, anon;
grant execute on function public.record_copyright_counter_notice(uuid, text, text, text, boolean, text, timestamptz) to authenticated;

create or replace function public.reinstate_after_counter_notice(p_notice uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.copyright_admin_step_up();
  v_notice public.copyright_notices%rowtype;
  v_counter public.copyright_counter_notices%rowtype;
  v_listings uuid[];
  v_restored uuid[];
  v_unblocked integer;
begin
  if p_note is null or length(btrim(p_note)) < 1 or length(p_note) > 4000 then
    raise exception 'A note of 1–4000 characters is required, saying the claimant has not told us of a court action' using errcode = '22023';
  end if;
  select * into v_notice from public.copyright_notices where id = p_notice for update;
  if not found or v_notice.status <> 'actioned' then raise exception 'Only a notice that was acted on can be reinstated' using errcode = '55000'; end if;
  select * into v_counter from public.copyright_counter_notices where notice_id = p_notice;
  if not found then raise exception 'Record the member''s counter-notice first' using errcode = '55000'; end if;
  if v_counter.received_at > now() - interval '14 days' then
    raise exception 'Content can be reinstated 14 days (ten business days) after the counter-notice arrived: on %', (v_counter.received_at + interval '14 days')::date
      using errcode = '22023';
  end if;
  -- No longer actioned, so it no longer holds its listings.
  update public.copyright_notices set status = 'reinstated' where id = p_notice;
  select coalesce(array_agg(x::uuid), '{}') into v_listings
    from (select jsonb_array_elements_text(coalesce(v_notice.takedown -> 'removedListings', '[]'::jsonb)) as x
          union select jsonb_array_elements_text(coalesce(v_notice.takedown -> 'keptListingStatus', '[]'::jsonb))) s;
  perform 1 from public.listings where id = any(v_listings) order by id for update;
  with back as (
    update public.listings
       set status = 'paused', removed_at = null, removed_reason = null
     where id = any(v_listings) and status = 'removed' and removed_reason like 'Copyright notice%'
       and not private.copyright_listing_held(id)
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_restored from back;
  delete from public.copyright_blocked_media where notice_id = p_notice;
  get diagnostics v_unblocked = row_count;
  insert into public.admin_audit_log (actor_id, action, subject_type, subject_id, reason, metadata)
  values (v_actor, 'copyright.reinstate', 'copyright_notice', p_notice, p_note,
          jsonb_build_object('phase', 'completed', 'counterNoticeId', v_counter.id, 'restoredListings', to_jsonb(v_restored), 'unblockedPhotos', v_unblocked));
  return jsonb_build_object('restoredListings', to_jsonb(v_restored), 'unblockedPhotos', v_unblocked,
    'owners', (select coalesce(jsonb_agg(distinct seller_id), '[]'::jsonb) from public.listings where id = any(v_restored)));
end;
$$;
revoke all on function public.reinstate_after_counter_notice(uuid, text) from public, anon;
grant execute on function public.reinstate_after_counter_notice(uuid, text) to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.copyright_counter_notices', 'select') then
    raise exception '20261110200000: counter-notices are readable by members';
  end if;
  raise notice 'PASS: 20261110200000 self-checks';
end $$;

notify pgrst, 'reload schema';
commit;
