-- social-13: a post's author can remove a reply from their own post.
--
-- Replies could only be deleted by whoever wrote them ("authors delete
-- comments"), so an abusive reply stayed under somebody's post until an
-- admin stepped in. This adds a second delete policy — RLS policies of the
-- same command are OR'd — letting the author of the post delete any reply
-- on it. The existing policies are unchanged (snapshot:
-- ~/drvn-db-backups/pre-20260928182200-activity_comments-policies.sql).
--
-- Idempotent.

begin;

drop policy if exists "post authors delete comments" on public.activity_comments;
create policy "post authors delete comments"
  on public.activity_comments
  for delete
  using (
    exists (
      select 1 from public.activity_posts p
      where p.id = activity_comments.post_id
        and p.author_id = auth.uid()
    )
  );

commit;
