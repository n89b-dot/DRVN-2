-- social-12 / admin-11 / admin-10: posts and replies can be reported, and a
-- suspended member stops posting, replying and making offers.
--
-- 1. reports.subject_type gains 'post' and 'comment' (was listing | user),
--    so the existing report flow and review queue cover a post or a reply.
--
-- 2. Suspension used to stop only new listings ("sellers insert listings"
--    checks is_suspended). Restrictive policies — AND'd with the existing
--    permissive ones, which stay as they are — now refuse, for a suspended
--    member: writing or editing a post (write_activity_post is security
--    invoker, so this covers the quick box and the editor), replying, and
--    making an offer (create_offer_with_message is invoker too).
--    Messages are the Messages session's; they are not changed here.
--
-- Previous constraint and policies: ~/drvn-db-backups/pre-20260928182300-moderation.sql
-- Idempotent.

begin;

alter table public.reports drop constraint if exists reports_subject_type_check;
alter table public.reports add constraint reports_subject_type_check
  check (subject_type in ('listing', 'user', 'post', 'comment'));

drop policy if exists "suspended members don't post" on public.activity_posts;
create policy "suspended members don't post"
  on public.activity_posts as restrictive for insert to authenticated
  with check (not public.is_suspended(auth.uid()));

drop policy if exists "suspended members don't edit posts" on public.activity_posts;
create policy "suspended members don't edit posts"
  on public.activity_posts as restrictive for update to authenticated
  using (true)
  with check (not public.is_suspended(auth.uid()));

drop policy if exists "suspended members don't reply" on public.activity_comments;
create policy "suspended members don't reply"
  on public.activity_comments as restrictive for insert to authenticated
  with check (not public.is_suspended(auth.uid()));

drop policy if exists "suspended members don't make offers" on public.offers;
create policy "suspended members don't make offers"
  on public.offers as restrictive for insert to authenticated
  with check (not public.is_suspended(auth.uid()));

commit;
