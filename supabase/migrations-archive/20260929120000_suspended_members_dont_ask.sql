-- A suspended member can't post on a listing's Q&A either.
--
-- 20260928182300 stopped suspended members posting, replying and making
-- offers; 20260929110000 (Messages) stopped them messaging. Listing questions
-- and answers were the one public writing surface left open. Same restrictive
-- shape: it narrows the existing "authed users ask questions" insert policy
-- without replacing it.
--
-- Idempotent: drop and re-create.

begin;

drop policy if exists "suspended members don't ask" on public.listing_questions;
create policy "suspended members don't ask" on public.listing_questions
  as restrictive for insert to authenticated
  with check (not public.is_suspended(auth.uid()));

commit;
