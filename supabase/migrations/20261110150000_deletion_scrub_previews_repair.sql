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
-- 2. Offer notices kept the seller's own words. notify_on_offer_response puts
--    the listing's title, which the seller wrote, in offer_declined and
--    offer_countered bodies; the scrub kept offer bodies as "DRVN's text" and
--    cleared actor_id, so no later scrub could find them. The scrub now clears
--    an offer notice's body too, and the repair clears it on notices already
--    rewritten: an offer notice with no actor whose offer's buyer or seller is
--    a scrubbed account.
--
-- Restated, from its latest definition with only the offer-body branch added:
--   public.scrub_deleted_account  from 20261108180000_deletion_late_holds_and_previews.sql
-- The repair is idempotent and prints what it changed.
-- ============================================================================

begin;

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

  -- N418: what they wrote, as other members' notifications copied it. The
  -- social and message triggers put the actor's name in the title and the
  -- first 140 characters of a comment, review, question or message in the
  -- body. The row and its link stay, except a link to the member's own
  -- profile, which names their retired handle. Order, offer, dispute,
  -- receipt and refund notifications carry only text DRVN writes, and lose
  -- only the actor.
  update public.notifications nt
     set title = case
           when nt.kind ~ '^(order|offer|dispute|receipt|refund)_' then nt.title
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
           -- 20261110150000 (Codex on #181): an offer notice's body is the
           -- listing's title, which the seller wrote; it goes too.
           when nt.kind ~ '^offer_' then null
           when nt.kind ~ '^(order|dispute|receipt|refund)_' then nt.body
           when nt.body is null then null
           else '(removed)'
         end,
         href = case
           when nt.target_id = p_user or (v_username is not null and nt.href = '/u/' || v_username) then null
           else nt.href
         end,
         actor_id = null
   where nt.actor_id = p_user;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('notifications_sent', n);

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
create or replace function private.repair_scrubbed_previews()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  left_drvn constant text := 'A member who has since left DRVN';
  v_actor integer := 0;
  v_links integer := 0;
  v_offers integer := 0;
  n integer;
  r record;
begin
  -- 1. Notifications an already-scrubbed member is still the actor of.
  for r in
    select d.user_id from public.account_deletion_requests d
     where d.scrubbed_at is not null and d.user_id is not null
  loop
    update public.notifications nt
       set title = case
             when nt.kind ~ '^(order|offer|dispute|receipt|refund)_' then nt.title
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
             when nt.kind ~ '^offer_' then null
             when nt.kind ~ '^(order|dispute|receipt|refund)_' then nt.body
             when nt.body is null then null
             else '(removed)'
           end,
           href = case when nt.target_id = r.user_id then null else nt.href end,
           actor_id = null
     where nt.actor_id = r.user_id;
    get diagnostics n = row_count; v_actor := v_actor + n;
  end loop;

  -- Links to a retired handle lead nowhere and name the member who left.
  update public.notifications nt
     set href = null
   where nt.href ~ '^/u/[a-z0-9_]{3,30}$'
     and exists (select 1 from private.username_tombstones t where '/u/' || t.username = nt.href);
  get diagnostics v_links = row_count;

  -- 2. Offer notices already rewritten without their actor: the title's
  --    source is gone, so the body (the listing's title) goes too.
  update public.notifications nt
     set body = null
   where nt.kind ~ '^offer_' and nt.actor_id is null and nt.body is not null
     and nt.href ~ '^/offers/[0-9a-f-]{36}$'
     and exists (
       select 1 from public.offers o
         join public.listings l on l.id = o.listing_id
         join public.account_deletion_requests d on d.user_id in (o.buyer_id, l.seller_id) and d.scrubbed_at is not null
        where o.id = substr(nt.href, 9)::uuid);
  get diagnostics v_offers = row_count;

  return jsonb_build_object('actor_rows', v_actor, 'retired_links', v_links, 'offer_bodies', v_offers);
end $$;
revoke all on function private.repair_scrubbed_previews() from public, anon, authenticated;

do $$
declare
  r jsonb := private.repair_scrubbed_previews();
begin
  raise notice '20261110150000 repair: % notifications of already-scrubbed members rewritten, % links to retired handles cleared, % offer notice bodies cleared',
    r->>'actor_rows', r->>'retired_links', r->>'offer_bodies';
end $$;

commit;
