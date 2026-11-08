-- OS-W33 follow-up to 20261107220700 (withdraw_listing), from the GPT review
-- of PR #122.
--
--   1. P1  A seller could undo moderation. withdraw_listing is a definer, so
--          its archive skipped guard_listing_status, which keeps 'removed'
--          for moderation to set and clear: a removed listing became
--          archived, and the seller could then publish it again. It now
--          refuses (LW403) any listing that isn't in a state its seller
--          owns (draft, active, paused, archived), before changing anything.
--   2. P1  Buyers lost their history. Archiving hid the listing from them
--          under "active listings readable", so the buyer following their
--          notification to /offers/{id} got a 404 (the page reads the
--          listing), and the offer dropped out of their Messages (which
--          embeds listings!inner). A member with an offer on a listing, or
--          an order for it, can now read it once it is archived, and its
--          photos: "deal participants read archived listings". The ids come
--          from public.my_deal_listing_ids(), a definer that returns only
--          the caller's own deals' listing ids, asked once per query; a
--          definer also keeps the policy from recursing (the offers read
--          policy reads listings).
--   3. P2  An already-archived listing kept its live offers. Archive changed
--          the status alone, and a later Withdraw answered "replayed"
--          before ending them or telling the buyers. withdraw_listing now
--          ends any live offers whatever the listing's state, and reports a
--          replay only when there was nothing left to do. A member's own
--          status change to archived is refused while the listing has live
--          offers (LW409, like the delete guard), so Archive goes through
--          withdraw_listing (the app does that now).
--
-- Restated from its latest definition: public.withdraw_listing
-- (20261107220700); only the moderation refusal and the archived handling
-- change. New: public.my_deal_listing_ids, two read policies, and the
-- private.guard_listing_archive_offers trigger. No money rule changes.

begin;

-- ------------------------------------------------------------
-- 1 and 3. withdraw_listing
-- ------------------------------------------------------------
create or replace function public.withdraw_listing(p_listing uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
  v_listing public.listings;
  v_offer record;
  v_ended integer := 0;
  v_round uuid;
begin
  if v_uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_listing is null then raise exception 'Missing listing' using errcode = '22023'; end if;

  -- Listing first: the lock every offer move and checkout takes first too.
  select * into v_listing from public.listings where id = p_listing for update;
  if not found or v_listing.seller_id is distinct from v_uid then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;
  if v_listing.status in ('reserved', 'sold') then
    raise exception 'This listing is mid-checkout or sold' using errcode = 'LW423';
  end if;
  -- This function is a definer, so guard_listing_status never sees its
  -- write: the moderation rule is restated here. Only a state the seller
  -- owns can be withdrawn; 'removed' (or any state moderation holds) is
  -- moderation's to set and to clear.
  if v_listing.status not in ('draft', 'active', 'paused', 'archived') or v_listing.removed_at is not null then
    raise exception 'This listing was removed by moderation' using errcode = 'LW403';
  end if;

  -- Live offers end whatever the listing's state: one archived before
  -- withdrawal existed, or by a status change, may still have some.
  -- The offer rounds below are this function's; the round trigger stays out.
  perform set_config('drvn.offer_move', 'on', true);
  for v_offer in
    select o.id, o.buyer_id, o.round_count from public.offers o
     where o.listing_id = p_listing and o.status in ('open', 'countered')
     order by o.id
     for update
  loop
    insert into public.offer_rounds (offer_id, round_no, listing_id, buyer_id, actor_role, kind, actor_member_id)
    values (v_offer.id, v_offer.round_count + 1, p_listing, v_offer.buyer_id, 'system', 'withdraw', null)
    returning id into v_round;
    update public.offers
       set status = 'withdrawn', ended_reason = 'listing_withdrawn', responded_at = now(),
           round_count = v_offer.round_count + 1, last_round_id = v_round
     where id = v_offer.id;
    perform public.notify(
      v_offer.buyer_id, 'offer_listing_withdrawn', 'marketplace',
      'The seller withdrew this listing', 'Your offer on "' || v_listing.title || '" has ended. Nothing was charged.',
      '/offers/' || v_offer.id, null
    );
    v_ended := v_ended + 1;
  end loop;
  perform set_config('drvn.offer_move', 'off', true);

  if v_listing.status <> 'archived' then
    update public.listings set status = 'archived' where id = p_listing;
  end if;
  -- A replay only when the work was already done: archived, nothing live.
  return jsonb_build_object(
    'outcome', 'withdrawn',
    'offers_ended', v_ended,
    'replayed', v_listing.status = 'archived' and v_ended = 0
  );
end;
$$;

revoke all on function public.withdraw_listing(uuid) from public, anon;
grant execute on function public.withdraw_listing(uuid) to authenticated;

comment on function public.withdraw_listing(uuid) is
  'N77: the seller withdraws a listing atomically (listing-first lock): live offers end with a listing-withdrawal reason, buyers are told, the listing is archived, nothing is deleted. Refuses a removed listing (LW403); ends live offers on an already-archived one.';

-- A member archiving a listing directly would leave its live offers open on
-- a listing being put away: refuse, and say to withdraw. Invoker, like
-- guard_listing_delete_history, so is_trusted_writer() sees the real caller
-- (withdraw_listing, a definer, ends the offers first anyway); only a
-- listing's seller can update it, and its seller reads every offer on it.
-- The listing row is already locked by this update, so an offer can't open
-- between the check and the commit (offer_open_core locks the listing first).
create or replace function private.guard_listing_archive_offers()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if public.is_trusted_writer() then
    return new;
  end if;
  if new.status = 'archived' and old.status is distinct from 'archived'
     and exists (select 1 from public.offers o where o.listing_id = old.id and o.status in ('open', 'countered')) then
    raise exception 'This listing has open offers. Withdraw it instead, so the buyers are told.'
      using errcode = 'LW409';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_listing_archive_offers() from public, anon, authenticated;

drop trigger if exists listings_guard_archive_offers on public.listings;
create trigger listings_guard_archive_offers
  before update of status on public.listings
  for each row execute function private.guard_listing_archive_offers();

-- ------------------------------------------------------------
-- 2. The buyer keeps the archived listing's context
-- ------------------------------------------------------------
-- The listings the caller has a deal on: an offer they made, or an order
-- they placed. Ids only, and only the caller's own; nothing for a visitor.
create or replace function public.my_deal_listing_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.listing_id from public.offers o
   where o.buyer_id = (select auth.uid())
  union
  select oi.listing_id from public.order_items oi
    join public.orders ord on ord.id = oi.order_id
   where ord.buyer_id = (select auth.uid()) and oi.listing_id is not null;
$$;

revoke all on function public.my_deal_listing_ids() from public, anon;
grant execute on function public.my_deal_listing_ids() to authenticated, service_role;

comment on function public.my_deal_listing_ids() is
  'OS-W33: ids of listings the caller made an offer on or ordered, for the archived-listing read policies; ids only, the caller''s own.';

-- Archived only: a removed listing stays moderation's, and a paused or
-- draft one stays its seller's. The restrictive "suspended listing
-- visibility" still applies on top.
drop policy if exists "deal participants read archived listings" on public.listings;
create policy "deal participants read archived listings" on public.listings
  for select to authenticated
  using (status = 'archived' and id in (select public.my_deal_listing_ids()));

drop policy if exists "deal participants read archived listing images" on public.listing_images;
create policy "deal participants read archived listing images" on public.listing_images
  for select to authenticated
  using (
    listing_id in (select public.my_deal_listing_ids())
    and exists (select 1 from public.listings l where l.id = listing_images.listing_id and l.status = 'archived')
  );

notify pgrst, 'reload schema';

commit;
