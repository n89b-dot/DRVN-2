-- OS-W21 N247: the social and messaging limits are held in the database.
--
-- The limits in src/lib/rate-limit.ts lived only in server actions, while a
-- member's own token can insert messages, replies, reactions, likes, follows,
-- saves, listing questions and reports straight through PostgREST
-- (docs/production-readiness-2026-11-03.md §2.1; Codex D3). A script with a
-- member's login skipped every limit and could flood a seller's inbox or
-- bury someone's notifications.
--
-- 1. A BEFORE INSERT trigger on each of those tables consumes a database
--    quota keyed on the signed-in member ("db-<action>:<uid>"), with the same
--    limit and window as the app's rule. The app's own check still runs first
--    and gives the friendly message; this is the boundary. It counts only
--    writes made with a member's token (auth.uid() is set): service-role
--    jobs, the agent worker and seeds are not members and are limited where
--    they run. A refused write raises SQLSTATE RL429.
-- 2. Follow, reaction, like-style and save notifications are de-duplicated
--    per recipient, actor, kind and target per day, so follow → unfollow →
--    follow no longer sends a fresh notification each time.
-- 3. Dispute-evidence uploads already need an open dispute (20261107203000);
--    files sitting in the uploader's folder for that order are now capped too,
--    so a member can't fill storage with uploads they never attach.
--
-- New functions only; no existing function is redefined. The upload policy
-- from 20261107203000 is replaced with the same rules plus the folder cap.

begin;

-- ------------------------------------------------------------
-- 1. Database write quotas
-- ------------------------------------------------------------
create or replace function private.member_write_quota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_action text := tg_argv[0];
  v_limit int := tg_argv[1]::int;
  v_window interval := tg_argv[2]::interval;
begin
  -- Only a member's own token is limited here; trusted server paths
  -- (service role, workers, migrations) carry no auth.uid().
  if v_uid is null then
    return new;
  end if;
  if not public.consume_rate_limit('db-' || v_action || ':' || v_uid::text, v_limit, v_window) then
    raise exception 'That''s a lot at once — try again in a few minutes.'
      using errcode = 'RL429',
            detail = format('%s: %s per %s', v_action, v_limit, v_window);
  end if;
  return new;
end;
$$;

revoke all on function private.member_write_quota() from public, anon, authenticated;

comment on function private.member_write_quota() is
  'N247: per-member insert quota (trigger args: action, limit, window). Mirrors src/lib/rate-limit.ts; raises RL429.';

-- The limits match RATE_LIMITS in src/lib/rate-limit.ts (DB_WRITE_QUOTAS
-- there is tested against this list).
drop trigger if exists messages_write_quota on public.messages;
create trigger messages_write_quota
  before insert on public.messages
  for each row execute function private.member_write_quota('message', '40', '10 minutes');

drop trigger if exists activity_comments_write_quota on public.activity_comments;
create trigger activity_comments_write_quota
  before insert on public.activity_comments
  for each row execute function private.member_write_quota('comment', '20', '10 minutes');

drop trigger if exists activity_reactions_write_quota on public.activity_reactions;
create trigger activity_reactions_write_quota
  before insert on public.activity_reactions
  for each row execute function private.member_write_quota('react', '60', '5 minutes');

-- Likes share the reaction rule in the app (src/features/social/actions.ts).
drop trigger if exists likes_write_quota on public.likes;
create trigger likes_write_quota
  before insert on public.likes
  for each row execute function private.member_write_quota('react', '60', '5 minutes');

drop trigger if exists follows_write_quota on public.follows;
create trigger follows_write_quota
  before insert on public.follows
  for each row execute function private.member_write_quota('follow', '60', '10 minutes');

-- Saves notify the owner too; the app has no save rule, so the database
-- quota is deliberately generous.
drop trigger if exists saves_write_quota on public.saves;
create trigger saves_write_quota
  before insert on public.saves
  for each row execute function private.member_write_quota('save', '120', '10 minutes');

drop trigger if exists listing_questions_write_quota on public.listing_questions;
create trigger listing_questions_write_quota
  before insert on public.listing_questions
  for each row execute function private.member_write_quota('question', '10', '10 minutes');

drop trigger if exists reports_write_quota on public.reports;
create trigger reports_write_quota
  before insert on public.reports
  for each row execute function private.member_write_quota('report', '5', '1 hour');

-- ------------------------------------------------------------
-- 2. One relationship notification per person, target and day
-- ------------------------------------------------------------
create or replace function private.dedupe_relationship_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.actor_id is null
     or new.kind not in ('follow', 'car_follow', 'reaction', 'save', 'like') then
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

-- Named to sort after notifications_set_target, so target_id is filled in
-- before the comparison (BEFORE triggers fire in name order).
drop trigger if exists notifications_zz_dedupe_relationship on public.notifications;
create trigger notifications_zz_dedupe_relationship
  before insert on public.notifications
  for each row execute function private.dedupe_relationship_notification();

create index if not exists notifications_relationship_dedupe_idx
  on public.notifications (user_id, actor_id, kind, created_at desc)
  where actor_id is not null;

-- ------------------------------------------------------------
-- 3. Dispute-evidence uploads: cap what sits in the folder
-- ------------------------------------------------------------
-- 8 photos may be attached (dispute_evidence); allow headroom for retries
-- and replaced photos, but not an unbounded pile.
-- Public (the upload policy runs as the member), but it answers only for
-- the caller's own folder, so it reveals nothing about anyone else.
create or replace function public.my_dispute_evidence_upload_count(p_order uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
    from storage.objects o
   where (select auth.uid()) is not null
     and o.bucket_id = 'dispute-evidence'
     and o.name like (select auth.uid())::text || '/' || p_order::text || '/%';
$$;

revoke all on function public.my_dispute_evidence_upload_count(uuid) from public, anon;
grant execute on function public.my_dispute_evidence_upload_count(uuid) to authenticated;

drop policy if exists "upload evidence into an open dispute" on storage.objects;
create policy "upload evidence into an open dispute" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'dispute-evidence'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,80}\.[A-Za-z0-9]{1,10}$'
    and split_part(name, '/', 1) = (select auth.uid())::text
    and exists (
      select 1
        from public.orders o
       where o.id = (case when split_part(name, '/', 2) ~ '^[0-9a-f-]{36}$' then split_part(name, '/', 2)::uuid end)
         and o.status = 'disputed'
         and (select auth.uid()) in (o.buyer_id, o.seller_id)
         and (select count(*) from public.dispute_evidence de
               where de.order_id = o.id and de.uploader_id = (select auth.uid())) < 8
         and public.my_dispute_evidence_upload_count(o.id) < 16
    )
  );

commit;
