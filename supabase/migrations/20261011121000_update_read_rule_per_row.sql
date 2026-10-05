-- The read rule on updates asks about each update's own car, by key.
--
-- WHO MAY SEE WHAT DOES NOT CHANGE: a published update is readable when it
-- has no car or its car is readable and public; an author always reads their
-- own (supabase/tests/update_read_rule_guard.sql states it for each kind of
-- reader and passes against the old policy too).
--
-- What changes is how the rule is asked. "exists (select 1 from cars where
-- id = car_id and is_public)" was answered by building a hash of every
-- public car first — 357,000 at 2M parts, about 100 ms on every request
-- that reads updates as a visitor, growing with the number of cars
-- (docs/performance/query-plans.md). Asked as "this update's car, by its
-- key: is it public?", it is one index lookup per update read. The car is
-- read under its own row security either way, so a suspended member's car
-- still hides its updates.
--
-- auth.uid() is wrapped in (select …): the same value, once per query.

alter policy "published activity readable" on public.activity_posts
  using ((published_at is not null
          and (car_id is null
               or coalesce((select c.is_public from public.cars c where c.id = activity_posts.car_id), false)))
         or (select auth.uid()) = author_id);
