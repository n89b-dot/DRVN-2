-- ============================================================================
-- 20261111160000 — a leaver's title with " · " left a saved-search notice when
-- they also own a title equal to one of its pieces (Codex's fix-check of
-- 20261111140000)
--
-- With titles "Alice 07123 · turbo" and "turbo", the body
-- "Fan · Alice 07123 · turbo · X" was cut piece by piece: the piece "turbo"
-- was replaced, so neither title was whole in what was left, the fallback of
-- 20261111140000 did not fire, and "Alice 07123" stayed.
--
--   * private.scrub_member_notices: the body is also neutralised when a title
--     of theirs is whole, between separators, in the original body but is not
--     itself one of its pieces. Only step 4's body expression changed.
--
-- No repair and no data change. A notice left by this case no longer carries
-- the title whole, so nothing can find it by title; the read-only counts were
-- 0 on shared dev and on staging on 11 November 2026, and no real members
-- exist yet.
--
-- Restated, from its latest definition (supabase/schema/functions/
-- private.scrub_member_notices.sql, from 20261111140000):
--   private.scrub_member_notices(uuid, text)
-- Guard: supabase/tests/deletion_scrub_separator_guard.sql (T5, T6).
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
         -- (20261111140000, Codex's final review). So does a title of theirs
         -- whole in the original body that is not itself a piece (20261111160000).
         body = (
           select case when exists (select 1 from mine m where strpos(c.cut, m.title) > 0)
                         or exists (select 1 from mine m
                                     where strpos(' · ' || nt.body || ' · ', ' · ' || m.title || ' · ') > 0
                                       and not (m.title = any (string_to_array(nt.body, ' · '))))
                       then a_matches else c.cut end
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

-- Self-check: the restated scrub carries the new test and is not open to members.
do $$
begin
  if position('m.title = any (string_to_array(nt.body' in pg_get_functiondef('private.scrub_member_notices(uuid, text)'::regprocedure)) = 0 then
    raise exception '20261111160000: private.scrub_member_notices was not restated';
  end if;
  if has_function_privilege('authenticated', 'private.scrub_member_notices(uuid, text)', 'execute')
     or has_function_privilege('anon', 'private.scrub_member_notices(uuid, text)', 'execute') then
    raise exception '20261111160000: private.scrub_member_notices is open to members';
  end if;
end $$;

commit;
