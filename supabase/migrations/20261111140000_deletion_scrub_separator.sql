-- ============================================================================
-- 20261111140000 — a deleted member's listing title that contains " · "
-- leaves other members' saved-search notices (Codex's final review, P1 on
-- 20261110220000_deletion_scrub_previews_repair.sql)
--
-- A saved-search notice's body is up to three listing titles joined by " · ".
-- The scrub split the body on " · " and compared each piece with the whole
-- title, so a title that itself contains the separator ("Alice 07123 ·
-- turbo") never equalled a piece: the notice was matched, and its body kept
-- the title. The same for a title ending in " ·".
--
--   * private.scrub_member_notices: when a title of theirs cannot be cut out
--     whole (any of their titles is still in what the cut leaves), the whole
--     body becomes one neutral line. Nothing else changed.
--   * private.repair_ambiguous_matched_titles(): a one-time repair, run
--     below, of notices an earlier scrub left. It changes only the body of a
--     saved-search notice that still carries, whole between separators, a
--     listing title of a member whose scrub is recorded (scrubbed_at set);
--     the body becomes the same neutral line. Idempotent: a repaired body no
--     longer carries the title. Count beforehand, read-only:
--       select count(*) from public.notifications nt
--        where private.notification_member_text(nt.kind) = 'matched_titles'
--          and nt.body is not null
--          and exists (select 1 from public.listings l
--                        join public.account_deletion_requests d on d.user_id = l.seller_id
--                       where d.scrubbed_at is not null and nt.user_id <> l.seller_id
--                         and l.title is not null and btrim(l.title) <> ''
--                         and strpos(' · ' || nt.body || ' · ', ' · ' || l.title || ' · ') > 0);
--
-- Restated, from its latest definition (supabase/schema/functions/
-- private.scrub_member_notices.sql, from 20261110220000):
--   private.scrub_member_notices(uuid, text)
-- Guard: supabase/tests/deletion_scrub_separator_guard.sql.
-- ============================================================================

begin;

CREATE OR REPLACE FUNCTION private.scrub_member_notices(p_user uuid, p_username text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  left_drvn constant text := 'A member who has since left DRVN';
  a_listing constant text := 'A listing by a member who has since left DRVN';
  a_matches constant text := 'Listings matched your saved search, including one by a member who has since left DRVN.';
  v_actor integer;
  v_offer integer;
  v_order integer;
  v_matched integer;
begin
  update public.notifications nt
     set title = case
           -- Not the actor's words: DRVN's title stays. An unclassified kind is treated as theirs.
           when coalesce(private.notification_member_text(nt.kind), 'actor') <> 'actor' then nt.title
           when nt.kind = 'follow' then left_drvn || ' followed you'
           when nt.kind = 'car_follow' then left_drvn || ' is following your build'
           when nt.kind in ('save', 'listing_save') then left_drvn || ' saved this'
           when nt.kind = 'comment' then left_drvn || ' commented on your update'
           when nt.kind = 'reaction' then left_drvn || ' reacted to your update'
           when nt.kind = 'review' then left_drvn || ' left you a review'
           when nt.kind = 'question' then left_drvn || ' wrote about your part'
           when nt.kind = 'message' then 'Message from a member who has since left DRVN'
           else left_drvn
         end,
         body = case
           -- Offer, order and saved-search bodies are decided by linkage below.
           when coalesce(private.notification_member_text(nt.kind), 'actor') <> 'actor' then nt.body
           when nt.body is null then null
           else '(removed)'
         end,
         href = case
           when nt.target_id = p_user or (p_username is not null and nt.href = '/u/' || p_username) then null
           else nt.href
         end,
         actor_id = null
   where nt.actor_id = p_user;
  get diagnostics v_actor = row_count;

  -- 2. Offers on the member's listings, as their buyers were told.
  with linked as (
    select o.buyer_id, '/offers/' || o.id as href from public.offers o
      join public.listings l on l.id = o.listing_id
     where l.seller_id = p_user and o.buyer_id <> p_user
    union all
    select x.buyer_id, '/orders/' || x.id || suffix from public.orders x
      join public.offers o on o.id = x.origin_offer_id
      join public.listings l on l.id = o.listing_id
      cross join (values (''), ('/checkout')) as v(suffix)
     where l.seller_id = p_user and x.buyer_id <> p_user
  )
  update public.notifications nt
     set body = case nt.kind
           when 'offer_listing_withdrawn' then 'Your offer on a listing by a member who has since left DRVN has ended. Nothing was charged.'
           when 'offer_agent_out_of_rounds' then a_listing || coalesce(substring(nt.body from ' · \$[0-9,.]+ over your max$'), '')
           else a_listing
         end
    from linked
   where nt.user_id = linked.buyer_id and nt.href = linked.href
     and coalesce(private.notification_member_text(nt.kind), 'listing_title') = 'listing_title' and nt.body is not null
     and nt.body not like a_listing || '%' and nt.body not like 'Your offer on a listing by a member who has since left DRVN%';
  get diagnostics v_offer = row_count;

  -- 3. Order notices quoting what the member wrote, as the other party got them.
  update public.notifications nt
     set body = case nt.kind
           when 'order_disputed' then 'The description of the problem was removed because the member who wrote it left DRVN. See the order for details.'
           else 'The reason was removed because a member on this order left DRVN. See the order for details.'
         end
    from public.orders x
   where p_user in (x.buyer_id, x.seller_id)
     and nt.user_id in (x.buyer_id, x.seller_id) and nt.user_id <> p_user
     and nt.href = '/orders/' || x.id
     and nt.body is not null
     and (
       (nt.kind = 'order_disputed' and coalesce(x.disputed_by, x.buyer_id) = p_user)
       or (nt.kind in ('order_cancelled', 'order_refunded')
           and nt.body not in ('checkout not completed in time', 'checkout abandoned')
           and nt.body !~* 'payouts weren''t set up within 14 days')
     )
     and nt.body not like 'The % was removed because %';
  get diagnostics v_order = row_count;

  -- 4. Saved-search notices that named the member's listings to other members
  --    (src/app/api/jobs/saved-searches/route.ts: the title ends ": <listing
  --    title>" for one match, the body is up to three titles joined by " · ").
  --    Nothing links such a notice to the listing, so it is found by the
  --    exact title, whole, in its place.
  with mine as (
    select distinct l.title from public.listings l
     where l.seller_id = p_user and l.title is not null and btrim(l.title) <> ''
  )
  update public.notifications nt
     set title = coalesce((
           select left(nt.title, length(nt.title) - length(m.title)) || a_listing from mine m
            where nt.title like 'New match for %' and right(nt.title, length(m.title) + 2) = ': ' || m.title
            order by length(m.title) desc limit 1), nt.title),
         -- A title is cut out whole, in its place. One that cannot be (it
         -- contains the separator, so no piece equals it, or any of their
         -- titles is still in what is left) takes the whole body with it
         -- (20261111140000, Codex's final review).
         body = (
           select case when exists (select 1 from mine m where strpos(c.cut, m.title) > 0) then a_matches else c.cut end
             from (select string_agg(case when exists (select 1 from mine m where m.title = e.t) then a_listing else e.t end, ' · ' order by e.ord) as cut
                     from unnest(string_to_array(nt.body, ' · ')) with ordinality as e(t, ord)) c)
   where private.notification_member_text(nt.kind) = 'matched_titles'
     and nt.user_id <> p_user
     and exists (
       select 1 from mine m
        where (nt.body is not null and strpos(' · ' || nt.body || ' · ', ' · ' || m.title || ' · ') > 0)
           or (nt.title like 'New match for %' and right(nt.title, length(m.title) + 2) = ': ' || m.title));
  get diagnostics v_matched = row_count;

  return jsonb_build_object('notifications_sent', v_actor, 'offer_notice_bodies', v_offer, 'order_notice_bodies', v_order, 'saved_search_notices', v_matched);
end $function$;

revoke all on function private.scrub_member_notices(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- One-time repair
-- ---------------------------------------------------------------------------
create or replace function private.repair_ambiguous_matched_titles()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a_matches constant text := 'Listings matched your saved search, including one by a member who has since left DRVN.';
  v_n integer;
begin
  update public.notifications nt
     set body = a_matches
   where private.notification_member_text(nt.kind) = 'matched_titles'
     and nt.body is not null
     and exists (select 1 from public.listings l
                   join public.account_deletion_requests d on d.user_id = l.seller_id
                  where d.scrubbed_at is not null and nt.user_id <> l.seller_id
                    and l.title is not null and btrim(l.title) <> ''
                    and strpos(' · ' || nt.body || ' · ', ' · ' || l.title || ' · ') > 0);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function private.repair_ambiguous_matched_titles() from public, anon, authenticated;

do $$
declare
  v_n integer;
begin
  v_n := private.repair_ambiguous_matched_titles();
  raise notice 'repair_ambiguous_matched_titles: % saved-search notice bodies neutralised', v_n;
  -- Self-check: no saved-search notice still carries a scrubbed member's title.
  if exists (select 1 from public.notifications nt
              where private.notification_member_text(nt.kind) = 'matched_titles'
                and nt.body is not null
                and exists (select 1 from public.listings l
                              join public.account_deletion_requests d on d.user_id = l.seller_id
                             where d.scrubbed_at is not null and nt.user_id <> l.seller_id
                               and l.title is not null and btrim(l.title) <> ''
                               and strpos(' · ' || nt.body || ' · ', ' · ' || l.title || ' · ') > 0)) then
    raise exception '20261111140000: a saved-search notice still carries a scrubbed member''s listing title';
  end if;
  -- Self-check: the restated scrub is in place and neither function is open to members.
  if position('a_matches' in pg_get_functiondef('private.scrub_member_notices(uuid, text)'::regprocedure)) = 0 then
    raise exception '20261111140000: private.scrub_member_notices was not restated';
  end if;
  if has_function_privilege('authenticated', 'private.repair_ambiguous_matched_titles()', 'execute')
     or has_function_privilege('anon', 'private.repair_ambiguous_matched_titles()', 'execute')
     or has_function_privilege('authenticated', 'private.scrub_member_notices(uuid, text)', 'execute')
     or has_function_privilege('anon', 'private.scrub_member_notices(uuid, text)', 'execute') then
    raise exception '20261111140000: a scrub function is open to members';
  end if;
end $$;

commit;
