-- ============================================================================
-- 20261110150000 — a deleted member's words leave other members' feeds, for
-- every case (Codex's review of #181, two P1s; report five follow-up)
--
-- 1. Cases scrubbed before 20261108180000 kept their previews. #149's scrub
--    removed only the notifications a member received; 20261108180000 added
--    the rewrite of every notification the member is the ACTOR of, but only
--    for scrubs that run from then on. Members already scrubbed by #149 (a
--    completed job, scrubbed_at set) still appear in other members' feeds by
--    name, with the first 140 characters of what they wrote, and with links
--    to their retired handle. A one-time repair below rewrites them the same
--    way, and clears any link to a retired handle (private.username_tombstones).
-- 2. Offer and order notices kept the leaver's own words (Codex, then the
--    reviewer's pass on #206). Many offer notices are written with no actor
--    (expiry, the agent's notices, a withdrawn listing), so a scrub by actor
--    never found them; order_disputed quotes the buyer's dispute text and
--    order_cancelled / order_refunded a cancel reason a party can write.
--    private.scrub_member_notices finds them by the offer or order they are
--    about and replaces the leaver's words with a line that still reads.
--    Bodies with none of the leaver's words stay.
--
-- Was: 2. Offer notices kept the seller's own words. notify_on_offer_response puts
--    the listing's title, which the seller wrote, in offer_declined and
--    offer_countered bodies; the scrub kept offer bodies as "DRVN's text" and
--    cleared actor_id, so no later scrub could find them. The scrub now clears
--    an offer notice's body too, and the repair clears it on notices already
--    rewritten: an offer notice with no actor whose offer's buyer or seller is
--    a scrubbed account.
--
-- The retired-link clearing is a scan of public.notifications: fine at
-- today's size, and the repair does it in batches of 5,000 regardless.
--
-- Restated, from its latest definition, with the notifications block moved
-- into private.scrub_member_notices (nothing else changed):
--   public.scrub_deleted_account  from 20261108180000_deletion_late_holds_and_previews.sql
-- The repair is idempotent and prints what it changed.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Whose words a notification kind carries (N1069, work review #153). The scrub below
-- reads this instead of listing kinds by hand, and a kind it does not know is
-- treated as carrying the actor's words, so a new kind is scrubbed by default.
--
--   actor          the actor's name in the title and their words in the body
--   listing_title  the body is, or quotes, a listing's title (its seller's words)
--   order_reason   the body can quote a reason a party to the order wrote
--   matched_titles titles of other members' listings that matched a saved search
--   none           DRVN's own words, or the recipient's own
--
-- src/lib/notifications/kinds.test.ts holds the app's registry and every kind
-- the app writes to this list. In the test database every insert of a kind
-- this function does not know is refused (private.guard_notification_kind,
-- switched on by drvn.strict_notification_kinds), so a guard or a browser test
-- that raises an unclassified kind fails.
-- ---------------------------------------------------------------------------
create or replace function private.notification_member_text(p_kind text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when p_kind in ('follow', 'car_follow', 'save', 'listing_save', 'comment', 'reaction', 'review', 'question', 'message') then 'actor'
    when p_kind in ('offer_new', 'offer_countered', 'offer_declined', 'offer_accepted', 'offer_counter_accepted', 'offer_withdrawn',
                    'offer_countered_back', 'offer_expired', 'offer_agent_recommends_accept', 'offer_agent_deal_reached',
                    'offer_agent_out_of_rounds', 'offer_listing_withdrawn') then 'listing_title'
    when p_kind in ('order_disputed', 'order_cancelled', 'order_refunded') then 'order_reason'
    when p_kind = 'saved_search' then 'matched_titles'
    when p_kind in ('order_sold', 'order_paid', 'order_shipped', 'order_delivered', 'order_completed', 'order_pending',
                    'order_requires_action', 'order_payment_failed',
                    'receipt_due', 'receipt_auto_confirmed', 'dispute_resolved', 'dispute_escalated',
                    'refund_offered', 'refund_offer_expired', 'payout_sent', 'payout_blocked',
                    'report_reviewed', 'post_removed', 'comment_removed', 'listing_removed', 'car_hidden', 'car_restored',
                    'account_suspended', 'account_restored', 'password_changed', 'copyright_takedown', 'policy_updated',
                    'admin_action') then 'none'
  end;
$$;
revoke all on function private.notification_member_text(text) from public, anon, authenticated;

-- SECURITY DEFINER, like the three triggers already on this table: a trigger
-- function runs as the role that writes the row, and the app writes
-- notifications with the server key (service_role), which has no USAGE on
-- schema private. Without it every such insert failed with "permission
-- denied for function notification_member_text", strict mode on or off,
-- because the permission is checked when the IF is set up (review of #206).
create or replace function private.guard_notification_kind()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if current_setting('drvn.strict_notification_kinds', true) = 'on' and private.notification_member_text(new.kind) is null then
    raise exception 'Notification kind "%" is not classified: say whose words it carries in private.notification_member_text (N1069, work review #153)', new.kind
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_notification_kind() from public, anon, authenticated;
drop trigger if exists notification_kind_classified on public.notifications;
create trigger notification_kind_classified
  before insert on public.notifications
  for each row execute function private.guard_notification_kind();

-- ---------------------------------------------------------------------------
-- The leaver's words in other members' notifications. One place, used by the
-- scrub and by the repair.
--
--   1. Notices the member is the actor of: the social and message triggers
--      put their name in the title and the first 140 characters of what they
--      wrote in the body. The title becomes a neutral line and the body
--      "(removed)"; a link to their own profile goes. Order, offer, dispute,
--      receipt and refund notices keep DRVN's title and lose only the actor.
--   2. Offer notices about a listing the member sold, whoever the actor (many
--      are written with none: offer_expired, offer_agent_recommends_accept,
--      offer_agent_out_of_rounds, offer_agent_deal_reached, which links to
--      /orders/<id>/checkout, and offer_listing_withdrawn): the body is or
--      quotes the listing's title, which the seller wrote. It becomes a line
--      that still reads ("A listing by a member who has since left DRVN"),
--      keeping any amount after it. A body with none of the leaver's words
--      stays: offer_new's amount, or the recipient's own title in
--      offer_withdrawn and offer_counter_accepted when the buyer leaves.
--   3. Order notices quoting the member's free text: order_disputed's body is
--      the buyer's dispute_reason; order_cancelled and order_refunded carry
--      cancel_reason, which a party can write. Each becomes a line saying
--      what was removed and pointing to the order. DRVN's own reasons
--      (checkout timeouts, the payout-setup refund) and payment failures
--      stay.
-- ---------------------------------------------------------------------------
create or replace function private.scrub_member_notices(p_user uuid, p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  left_drvn constant text := 'A member who has since left DRVN';
  a_listing constant text := 'A listing by a member who has since left DRVN';
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
         body = (
           select string_agg(case when exists (select 1 from mine m where m.title = e.t) then a_listing else e.t end, ' · ' order by e.ord)
             from unnest(string_to_array(nt.body, ' · ')) with ordinality as e(t, ord))
   where private.notification_member_text(nt.kind) = 'matched_titles'
     and nt.user_id <> p_user
     and exists (
       select 1 from mine m
        where (nt.body is not null and strpos(' · ' || nt.body || ' · ', ' · ' || m.title || ' · ') > 0)
           or (nt.title like 'New match for %' and right(nt.title, length(m.title) + 2) = ': ' || m.title));
  get diagnostics v_matched = row_count;

  return jsonb_build_object('notifications_sent', v_actor, 'offer_notice_bodies', v_offer, 'order_notice_bodies', v_order, 'saved_search_notices', v_matched);
end $$;
revoke all on function private.scrub_member_notices(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The leaver's listing titles in saved-search emails (N1069, work review #153).
-- saved_search_email_digests.items holds {id, title, price_cents} for up to
-- ten listings; rows are kept 90 days. An item is the member's when its
-- listing is theirs, or is gone altogether.
--   - A digest not yet sent loses those items; with none left it is not sent
--     (skip_reason 'listings_removed').
--   - A digest already sent, skipped or failed keeps its shape, and the item's
--     title becomes a neutral line.
-- ---------------------------------------------------------------------------
alter table public.saved_search_email_digests drop constraint if exists saved_search_email_digests_skip_reason;
alter table public.saved_search_email_digests add constraint saved_search_email_digests_skip_reason check (
  (status = 'skipped') = (skip_reason is not null)
  and (skip_reason is null or skip_reason in ('opted_out', 'alert_off', 'no_address', 'account_closed', 'expired', 'carried', 'listings_removed')));

create or replace function private.scrub_member_digest_items(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a_listing constant text := 'A listing by a member who has since left DRVN';
  v_trimmed integer;
  v_skipped integer;
  v_neutral integer;
begin
  with item as (
    select d.id as digest_id, e.i, e.ord,
           -- The member's, or no longer there at all.
           (e.i->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             or not exists (select 1 from public.listings l where l.id = (e.i->>'id')::uuid and l.seller_id is distinct from p_user) as theirs
      from public.saved_search_email_digests d
      cross join lateral jsonb_array_elements(d.items) with ordinality as e(i, ord)
  ), hit as (
    select digest_id,
           jsonb_agg(i order by ord) filter (where not theirs) as kept,
           jsonb_agg(case when theirs then jsonb_set(i, '{title}', to_jsonb(a_listing)) else i end order by ord) as neutral,
           count(*) filter (where theirs) as gone,
           bool_or(theirs and i->>'title' is distinct from a_listing) as changes
      from item group by digest_id
    having bool_or(theirs)
  ), done as (
    update public.saved_search_email_digests d
       set items = case when d.status in ('pending', 'sending') and hit.kept is not null then hit.kept else hit.neutral end,
           match_count = case when d.status in ('pending', 'sending') and hit.kept is not null
                              then greatest(d.match_count - hit.gone::integer, jsonb_array_length(hit.kept)) else d.match_count end,
           status = case when d.status in ('pending', 'sending') and hit.kept is null then 'skipped' else d.status end,
           skip_reason = case when d.status in ('pending', 'sending') and hit.kept is null then 'listings_removed' else d.skip_reason end,
           updated_at = now()
      from hit
     where d.id = hit.digest_id
       and (d.status in ('pending', 'sending') or hit.changes)
    returning (d.status = 'skipped' and d.skip_reason = 'listings_removed' and hit.kept is null) as skipped,
              (hit.kept is not null and d.items = hit.kept) as trimmed
  )
  select count(*) filter (where trimmed and not skipped), count(*) filter (where skipped), count(*) filter (where not trimmed and not skipped)
    into v_trimmed, v_skipped, v_neutral from done;
  return jsonb_build_object('digests_trimmed', v_trimmed, 'digests_not_sent', v_skipped, 'digest_titles_removed', v_neutral);
end $$;
revoke all on function private.scrub_member_digest_items(uuid) from public, anon, authenticated;

create or replace function public.scrub_deleted_account(p_user uuid, p_email_digest text, p_digest_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.account_deletion_requests%rowtype;
  v_blockers jsonb;
  v_last_activity timestamptz;
  v_username text;
  v_counts jsonb := '{}'::jsonb;
  n integer;
  removed constant text := 'Removed: this member deleted their account.';
  left_drvn constant text := 'A member who has since left DRVN';
begin
  if p_user is null then
    raise exception 'A deletion scrub needs an account' using errcode = '22023';
  end if;
  -- The deletion lock the hold gate, finalise and the hold requeue take
  -- (20261108130400), so a hold can't commit halfway through a scrub.
  perform pg_advisory_xact_lock(private.account_deletion_lock_key(p_user));

  select * into v_request from public.account_deletion_requests where user_id = p_user for update;
  -- A case resumed after a hold still reads temporary_financial_hold until
  -- its outcome is recorded, so the live blocker check below decides.
  if not found
     or not exists (select 1 from public.remediation_jobs j where j.dedup_key = 'delete:' || p_user::text) then
    raise exception 'This account has no deletion under way' using errcode = '55000';
  end if;
  -- Never while money is still moving: the other party may need the address.
  v_blockers := public.account_deletion_blockers(p_user);
  if coalesce((v_blockers->>'financial_hold')::boolean, true) then
    raise exception 'This account still has orders or payments in progress' using errcode = '55000';
  end if;
  if v_request.email_digest is null and p_email_digest is not null then
    if p_email_digest !~ '^[0-9a-f]{64}$' or nullif(btrim(p_digest_key), '') is null then
      raise exception 'The email digest is malformed' using errcode = '22023';
    end if;
  end if;

  perform set_config('drvn.account_scrub', p_user::text, true);

  -- Auth: the email, the phone, the sign-in metadata, and linked identities
  -- (a Google identity carries the email and name). Sessions were revoked
  -- by the ban before this runs.
  update auth.users
     set email = null,
         email_change = '',
         raw_user_meta_data = '{}'::jsonb
   where id = p_user;
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users' and column_name = 'phone') then
    update auth.users set phone = null, phone_change = '' where id = p_user;
  end if;
  if to_regclass('auth.identities') is not null then
    update auth.identities
       set identity_data = jsonb_strip_nulls(jsonb_build_object(
             'sub', identity_data->'sub', 'provider_id', identity_data->'provider_id'))
     where user_id = p_user;
  end if;
  delete from public.account_emails where user_id = p_user;
  update public.beta_memberships
     set email_normalized = 'deleted-' || p_user::text || '@deleted.invalid'
   where user_id = p_user;
  update public.beta_invitations
     set email_normalized = 'deleted-' || p_user::text || '@deleted.invalid'
   where consumed_by = p_user;

  -- The profile: the handle is retired (N38), never handed out again.
  select username into v_username from public.profiles where id = p_user;
  if v_username is not null and v_username ~ '^[a-z0-9_]{3,30}$' then
    -- N418: the claim's lock (guard_username_choice), so a claim of this
    -- handle can't slip in between the tombstone and the commit.
    perform pg_advisory_xact_lock(private.username_lock_key(v_username));
    insert into private.username_tombstones (username) values (v_username) on conflict (username) do nothing;
  end if;
  update public.profiles
     set avatar_url = null, display_name = 'Deleted member', username = null, bio = null,
         headline = null, location = null, country = null, region = null, store_note = null,
         main_car_id = null, default_offer_floor_pct = null, links = '[]'::jsonb
   where id = p_user;

  -- Addresses: their ship-from and return addresses, the delivery details
  -- on orders they bought (country and the collection flag stay, as keys),
  -- and the shipping snapshot a checkout journalled.
  delete from public.seller_fulfillment_profiles where seller_id = p_user;
  update public.orders
     set ship_name = null, ship_line1 = null, ship_line2 = null, ship_city = null,
         ship_postcode = null, ship_state = null, ship_phone = null,
         accepted_checkout_shipping = case when accepted_checkout_shipping is null then null
           else jsonb_strip_nulls(jsonb_build_object(
             'country', accepted_checkout_shipping->'country',
             'isCollection', accepted_checkout_shipping->'isCollection')) end,
         buyer_label = 'Deleted member'
   where buyer_id = p_user;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('orders_bought', n);
  update public.purchase_attempts
     set checkout_context = checkout_context - 'shipping' - 'destinationHash'
   where buyer_id = p_user and checkout_context is not null;

  -- Order party labels on the other side.
  update public.orders set seller_label = 'Deleted member' where seller_id = p_user;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('orders_sold', n);

  -- What they wrote. Message threads and question threads keep their shape
  -- (the other party's replies still make sense); comments go.
  update public.messages
     set body = removed, attachments = '{}'
   where sender_id = p_user and kind = 'message'
     and (body is distinct from removed or cardinality(attachments) > 0);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('messages', n);
  update public.conversations c
     set last_message_preview = removed
    from public.messages m
   where m.id = c.last_message_id and m.sender_id = p_user and m.kind = 'message'
     and c.last_message_preview is distinct from removed;
  update public.listing_questions
     set body = removed
   where author_id = p_user and body is distinct from removed;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('questions', n);
  delete from public.activity_comments where author_id = p_user;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('comments', n);

  -- N418 and 20261110150000: what they wrote, as other members'
  -- notifications copied it, found by actor and by the offer or order the
  -- notice is about (private.scrub_member_notices, below).
  v_counts := v_counts || private.scrub_member_notices(p_user, v_username);
  -- Their listing titles in other members' saved-search emails (N1069, work review #153).
  v_counts := v_counts || private.scrub_member_digest_items(p_user);

  -- Their own social record, none of it a transaction key.
  delete from public.notifications where user_id = p_user;
  delete from public.saved_searches where user_id = p_user;
  delete from public.follows where follower_id = p_user or (target_type = 'profile' and target_id = p_user);
  delete from public.listing_imports where user_id = p_user;

  -- The retention clock, fixed on the first scrub.
  select max(greatest(coalesce(o.completed_at, '-infinity'), coalesce(o.refunded_at, '-infinity'),
                      coalesce(o.cancelled_at, '-infinity'), o.updated_at))
    into v_last_activity
    from public.orders o
   where o.buyer_id = p_user or o.seller_id = p_user;

  update public.account_deletion_requests
     set email_digest = coalesce(email_digest, p_email_digest),
         email_digest_key = case when email_digest is null and p_email_digest is not null
                                 then btrim(p_digest_key) else email_digest_key end,
         scrubbed_at = coalesce(scrubbed_at, now()),
         retention_starts_at = coalesce(retention_starts_at, greatest(now(), coalesce(v_last_activity, now()))),
         retain_until = coalesce(retain_until, greatest(now(), coalesce(v_last_activity, now())) + interval '6 years'),
         -- Decided now: the retention period (6 years) and what the
         -- anonymization removes (this scrub).
         policy_decisions_pending = array_remove(array_remove(policy_decisions_pending,
           'financial record retention duration'), 'eventual identity anonymization'),
         updated_at = now()
   where id = v_request.id
  returning retain_until into v_request.retain_until;

  -- The address exception ends with the scrub, not with the transaction.
  perform set_config('drvn.account_scrub', '', true);
  return v_counts || jsonb_build_object('retain_until', v_request.retain_until);
end;
$$;

revoke all on function public.scrub_deleted_account(uuid, text, text) from public, anon, authenticated;
grant execute on function public.scrub_deleted_account(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- One-time repair
-- ---------------------------------------------------------------------------
create or replace function private.repair_scrubbed_previews(p_batch integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_counts jsonb;
  v_actor integer := 0;
  v_offers integer := 0;
  v_orders integer := 0;
  v_links integer := 0;
  v_matched integer := 0;
  v_digests integer := 0;
  n integer;
  r record;
begin
  -- 1. Every already-scrubbed member, through the same rules as the scrub.
  --    Each member's notices are found through indexed keys (actor, the
  --    recipient of an offer or order of theirs), one member at a time.
  for r in
    select d.user_id from public.account_deletion_requests d
     where d.scrubbed_at is not null and d.user_id is not null
  loop
    v_counts := private.scrub_member_notices(r.user_id, null) || private.scrub_member_digest_items(r.user_id);
    v_actor := v_actor + (v_counts->>'notifications_sent')::integer;
    v_offers := v_offers + (v_counts->>'offer_notice_bodies')::integer;
    v_orders := v_orders + (v_counts->>'order_notice_bodies')::integer;
    v_matched := v_matched + (v_counts->>'saved_search_notices')::integer;
    v_digests := v_digests + (v_counts->>'digests_trimmed')::integer + (v_counts->>'digests_not_sent')::integer + (v_counts->>'digest_titles_removed')::integer;
  end loop;
  -- With no scrubbed member at all, a digest can still name a listing that is gone.
  v_counts := private.scrub_member_digest_items(null);
  v_digests := v_digests + (v_counts->>'digests_trimmed')::integer + (v_counts->>'digests_not_sent')::integer + (v_counts->>'digest_titles_removed')::integer;

  -- 2. Links to a retired handle lead nowhere and name the member who left.
  --    A scan of notifications, so in batches; one batch is enough today.
  loop
    update public.notifications nt
       set href = null
     where nt.id in (
       select x.id from public.notifications x
        where x.href ~ '^/u/[a-z0-9_]{3,30}$'
          and exists (select 1 from private.username_tombstones t where '/u/' || t.username = x.href)
        limit greatest(coalesce(p_batch, 5000), 1));
    get diagnostics n = row_count;
    v_links := v_links + n;
    exit when n = 0;
  end loop;

  return jsonb_build_object('actor_rows', v_actor, 'offer_bodies', v_offers, 'order_bodies', v_orders, 'retired_links', v_links,
    'saved_search_notices', v_matched, 'saved_search_digests', v_digests);
end $$;
drop function if exists private.repair_scrubbed_previews();
revoke all on function private.repair_scrubbed_previews(integer) from public, anon, authenticated;

do $$
declare
  r jsonb := private.repair_scrubbed_previews();
begin
  raise notice '20261110150000 repair: % notifications of already-scrubbed members rewritten, % offer and % order notice bodies made neutral, % links to retired handles cleared, % saved-search notices and % saved-search emails cleared of a departed member''s listing titles',
    r->>'actor_rows', r->>'offer_bodies', r->>'order_bodies', r->>'retired_links', r->>'saved_search_notices', r->>'saved_search_digests';
end $$;

commit;
