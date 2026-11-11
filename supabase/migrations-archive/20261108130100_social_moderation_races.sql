-- OS-W21 follow-up (Codex review of PR #95): four gaps in 20261107220000 and
-- 20261107220010.
--
-- 1. A hold could leave a build public (P1). Placing a hold updated the car
--    only `where is_public`, which reads the last committed row. If the
--    owner's publish had already passed the hold check (no hold yet) but not
--    committed, the hold saw is_public = false, skipped the update without
--    waiting for the publish's row lock, and committed; the publish then
--    committed public with a hold on file. The hold now updates the car
--    unconditionally, so it always takes the car's row lock: it waits for an
--    in-flight publish and then makes the build private. In the other order
--    the publish waits for the hold's row lock, and its BEFORE trigger
--    (car_moderation_hold_keeps_private, volatile, so it reads a fresh
--    snapshot after the wait) then sees the committed hold and keeps the
--    build private. Either way the build is never public with a hold.
-- 2. The evidence folder cap raced (P2). Each concurrent upload counted the
--    same committed files (15) and all passed the cap of 16. The count the
--    upload policy calls now first takes a transaction lock per uploader and
--    order, then counts with a fresh snapshot, so concurrent uploads into one
--    folder are counted one after another. The upload policy itself
--    (20261107220000, replacing #73's 20261107203000) is unchanged: it
--    already calls this function.
-- 3. Listing saves skipped de-duplication (P2). notify_on_save sends a saved
--    part as kind 'listing_save', which the allowlist left out, so save →
--    unsave → save notified the seller every time. It is on the list now.
-- 4. Removing a post with more than 1,000 replies left reports open (P2).
--    The admin action listed the replies through PostgREST, which caps a
--    read at max_rows = 1000, so reports on the rest were never closed and
--    their reporters never told. take_down_reported_content does the whole
--    takedown in one transaction: it closes every open report on the thing
--    and, for a post, on its replies through a join, before the delete
--    cascades the replies away, and returns the closed reports in one jsonb
--    value (not a row set, so max_rows doesn't apply) for the app to notify.
--
-- The message and block triggers belong to #128 and are not touched here.

begin;

-- ------------------------------------------------------------
-- 1. A hold always takes the car's row lock
-- ------------------------------------------------------------
create or replace function private.car_moderation_hold_apply()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Unconditional on purpose: filtering on is_public read the last
  -- committed row and skipped a car whose publish was still in flight,
  -- without waiting for it. Updating every time takes the row lock, so this
  -- waits for that publish to commit and then makes the build private.
  update public.cars set is_public = false where id = new.car_id;
  return new;
end;
$$;

revoke all on function private.car_moderation_hold_apply() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Evidence uploads into one folder are counted one at a time
-- ------------------------------------------------------------
create or replace function public.my_dispute_evidence_upload_count(p_order uuid)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count int;
begin
  if v_uid is null then
    return 0;
  end if;
  -- Held to the end of the upload's transaction: a second upload into the
  -- same folder waits here until the first has committed (or failed), and
  -- the count below, a new statement with a new snapshot, then includes it.
  perform pg_advisory_xact_lock(
    hashtextextended('dispute-evidence-upload:' || v_uid::text || ':' || coalesce(p_order::text, ''), 0)
  );
  select count(*)::int into v_count
    from storage.objects o
   where o.bucket_id = 'dispute-evidence'
     and o.name like v_uid::text || '/' || p_order::text || '/%';
  return v_count;
end;
$$;

revoke all on function public.my_dispute_evidence_upload_count(uuid) from public, anon;
grant execute on function public.my_dispute_evidence_upload_count(uuid) to authenticated;

comment on function public.my_dispute_evidence_upload_count(uuid) is
  'N247: the caller''s own files in one order''s dispute-evidence folder. Locks that folder for the transaction first, so the upload policy''s cap of 16 holds under concurrent uploads.';

-- ------------------------------------------------------------
-- 3. Listing saves are de-duplicated like every other save
-- ------------------------------------------------------------
create or replace function private.dedupe_relationship_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 'listing_save' is what notify_on_save sends for a saved part.
  if new.actor_id is null
     or new.kind not in ('follow', 'car_follow', 'reaction', 'save', 'listing_save', 'like') then
    return new;
  end if;
  -- Serialise the same (recipient, actor, kind, target) so two racing
  -- inserts can't both pass the check.
  perform pg_advisory_xact_lock(
    hashtextextended(new.user_id::text || ':' || new.actor_id::text || ':' || new.kind || ':' ||
                     coalesce(new.target_id::text, new.href, ''), 0)
  );
  if exists (
    select 1 from public.notifications n
     where n.user_id = new.user_id
       and n.actor_id = new.actor_id
       and n.kind = new.kind
       and n.target_id is not distinct from new.target_id
       and n.href is not distinct from new.href
       and n.created_at > now() - interval '1 day'
  ) then
    return null; -- already told today: skip the duplicate quietly
  end if;
  return new;
end;
$$;

revoke all on function private.dedupe_relationship_notification() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. Removing a reported post or reply, in one transaction
-- ------------------------------------------------------------
create or replace function public.take_down_reported_content(
  p_actor uuid,
  p_report uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_report public.reports;
  v_note text;
  v_removed jsonb;
  v_replies int := 0;
  v_closed jsonb;
begin
  perform public.assert_admin_actor(p_actor);
  if p_reason is null or length(btrim(p_reason)) < 1 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  v_note := left('Removed: ' || btrim(p_reason), 4000);

  select * into v_report from public.reports where id = p_report for update;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  if v_report.subject_type not in ('post', 'comment') then
    raise exception 'Only a reported post or reply is removed from here' using errcode = '22023';
  end if;

  -- Lock the thing being removed. For a post this also holds off new
  -- replies (their foreign-key check waits on this lock, then fails).
  if v_report.subject_type = 'post' then
    select jsonb_build_object('id', p.id, 'author_id', p.author_id, 'car_id', p.car_id, 'title', p.title,
                              'intro', p.intro, 'body', p.body, 'published_at', p.published_at)
      into v_removed
      from public.activity_posts p where p.id = v_report.subject_id for update;
    if v_removed is null then
      raise exception 'That post is already gone.' using errcode = 'P0002';
    end if;
    select count(*)::int into v_replies from public.activity_comments c where c.post_id = v_report.subject_id;
  else
    select jsonb_build_object('id', c.id, 'author_id', c.author_id, 'post_id', c.post_id, 'body', c.body,
                              'created_at', c.created_at)
      into v_removed
      from public.activity_comments c where c.id = v_report.subject_id for update;
    if v_removed is null then
      raise exception 'That reply is already gone.' using errcode = 'P0002';
    end if;
  end if;

  -- Every open report on the thing and, for a post, on its replies — found
  -- by a join, so no reply count is too large — closed before the delete
  -- takes the replies with it (N140).
  with closed as (
    update public.reports r
       set status = 'actioned', resolved_by = p_actor, resolved_at = now(), resolution_note = v_note
     where r.status = 'open'
       and (
         (r.subject_type = v_report.subject_type and r.subject_id = v_report.subject_id)
         or (v_report.subject_type = 'post' and r.subject_type = 'comment' and r.subject_id in (
               select c.id from public.activity_comments c where c.post_id = v_report.subject_id))
       )
    returning r.id, r.subject_type, r.reporter_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'subject_type', subject_type, 'reporter_id', reporter_id)
                            order by id), '[]'::jsonb)
    into v_closed
    from closed;

  if v_report.subject_type = 'post' then
    delete from public.activity_posts where id = v_report.subject_id;
  else
    delete from public.activity_comments where id = v_report.subject_id;
  end if;

  return jsonb_build_object('removed', v_removed, 'replyCount', v_replies, 'closed', v_closed);
end;
$$;

revoke all on function public.take_down_reported_content(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.take_down_reported_content(uuid, uuid, text) to service_role;

comment on function public.take_down_reported_content(uuid, uuid, text) is
  'N140/OS-W21: removes a reported post or reply and, in the same transaction, closes every open report on it and on a post''s replies. Service role only; the actor must be a full admin.';

notify pgrst, 'reload schema';

commit;
