-- The read rules on parts, cars and part photos, asked once per query
-- instead of once per row.
--
-- WHO MAY SEE WHAT DOES NOT CHANGE. A suspended member's parts and cars are
-- hidden from everyone but that member, exactly as before
-- (supabase/tests/read_rules_guard.sql).
--
-- What changes is how the rule is asked. The policies called
-- is_suspended(seller) / profile_is_visible(seller) for every row read: two
-- security-definer calls a row, about 6 µs each, which the planner cannot
-- fold into the query. At ~100x the beta that was most of the cost of every
-- count and every full scan (docs/performance/query-plans.md). The policies
-- now ask "is this seller in the set of suspended members?", and the set is
-- fetched once per query.
--
-- THE ONE NEW EXPOSURE: public.suspended_profile_ids() is callable by
-- signed-out and signed-in clients — it has to be, a policy runs as the
-- caller — and returns the ids of every suspended member in one call. Until
-- now a client could ask is_suspended(id) one id at a time (it is on the
-- reviewed list in definer_exposure_guard.sql for the same reason), and
-- member ids are public, so the same answer was already obtainable by
-- asking once per member. Ids only: no names, reasons or dates.
--
-- auth.uid() and is_admin() are wrapped in (select …) in the same policies:
-- the same value, computed once per query rather than once per row.

create index if not exists profiles_suspended_idx
  on public.profiles (id) where suspended_at is not null;

create or replace function public.suspended_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p.id from public.profiles p where p.suspended_at is not null;
$function$;
revoke all on function public.suspended_profile_ids() from public;
grant execute on function public.suspended_profile_ids() to anon, authenticated, service_role;

-- seller_id / owner_id are NOT NULL foreign keys to profiles, so "not in the
-- suspended set" is exactly "the profile exists and is not suspended".

alter policy "suspended car visibility" on public.cars
  using (owner_id = (select auth.uid())
         or owner_id not in (select public.suspended_profile_ids()));

alter policy "public cars readable" on public.cars
  using (is_public or (select auth.uid()) = owner_id);

alter policy "suspended listing visibility" on public.listings
  using (seller_id = (select auth.uid())
         or seller_id not in (select public.suspended_profile_ids()));

alter policy "active listings readable" on public.listings
  using ((status = any (array['active'::text, 'reserved'::text, 'sold'::text])
          and seller_id not in (select public.suspended_profile_ids()))
         or (select auth.uid()) = seller_id
         or (select public.is_admin()));

alter policy "listing images follow listing" on public.listing_images
  using (exists (
    select 1 from public.listings l
    where l.id = listing_images.listing_id
      and ((l.status = any (array['active'::text, 'reserved'::text, 'sold'::text])
            and l.seller_id not in (select public.suspended_profile_ids()))
           or l.seller_id = (select auth.uid())
           or (select public.is_admin()))));
