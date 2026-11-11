-- Posting failed with PGRST203 ("could not choose the best candidate function")
-- on the shared dev project: two overloads of write_activity_post existed.
--
-- 20260919194000 drops the 8-argument form and replaces it with the
-- 9-argument form (p_listing_ids uuid[] default null). In filename order that
-- is the end state. But the 2026-09-24 catch-up applied the September 5 chain
-- after the September 19 files, and 20260905230238 re-created the 8-argument
-- form beside the 9-argument one. Its signature differs, so the catch-up's
-- same-signature comparison did not restore it. With both present, PostgREST
-- cannot resolve any call that omits p_listing_ids: full updates, drafts,
-- autosave, edits and untagged quick posts.
--
-- Dropping the 8-argument form restores the fresh-install state. Calls that
-- omit p_listing_ids resolve to the 9-argument form through its default.
--
-- Idempotent: drop if exists.

begin;

drop function if exists public.write_activity_post(text, uuid, uuid, text, jsonb, text[], text, text);

commit;
