-- 20261017160000 — negotiation v2 moves: offer_open and offer_move (A1, step
-- two: switch; docs/decisions/negotiation-v2.md).
--
-- Two SECURITY DEFINER functions now make every negotiation move, by a person
-- today and by the agent from A2, under the v2 rules:
--   * offer_open(offer, listing, amount, message): the buyer's opening offer.
--   * offer_move(offer, kind, amount, idempotency_key, expected_round): a
--     counter (the seller's, or the buyer's counter-back), accept, decline
--     or withdraw.
-- Each one, in a single transaction:
--   1. locks the listing, then the offer (the one lock order: listing →
--      offer → order → payment; acceptance then runs offer_accept_begin
--      under those locks);
--   2. checks the actor (the buyer or the listing's seller, not suspended),
--      the round (expected_round must equal the offer's round_count), the
--      turn (open = the seller's, countered = the buyer's) and the limits:
--      a seller counter above the buyer's amount, at or below the asking
--      price and at or above the minimum; a buyer counter-back above their
--      last amount and below the counter; 3 buyer offers per listing,
--      counted across every thread (live offers at the switch count as the
--      first, as Neil ruled);
--   3. records a below-minimum attempt as a declined round that uses one of
--      the 3, and refuses without naming the minimum;
--   4. applies a rate limit inside the transaction (it fails closed);
--   5. appends the round, keeps the minimum in force for a proposal in
--      offer_round_terms, and updates the offer's current state; every move
--      gets a fresh 72 hours.
-- A repeated idempotency key replays the first result; a stale round is
-- refused.
--
-- Rollout: today's paths (create_offer_with_message, the app's direct
-- updates, offer_accept_begin) keep working until the switched app is live
-- everywhere, and the round recorder still covers them. A later contract
-- step removes them and the client write policies on offers.
--
-- Also here: seller cancellation is refused once checkout has begun (O-5);
-- offer_expired notifies both sides and offer_countered_back the seller; an
-- attempt declined at once doesn't announce a new offer.
-- Errors offer_move raises for the app to map: OF001 no offers left, OF002 not
-- your turn, OF003 stale round, OF004 amount out of bounds, OF005 already
-- settled, OF007 part no longer available, OF009 too many moves.
-- Idempotent.

begin;

alter table public.offers add column if not exists round_count integer not null default 0;
alter table public.offers add column if not exists last_round_id uuid references public.offer_rounds(id) on delete set null;

update public.offers o set round_count = r.n, last_round_id = r.last_id
from (
  select offer_id, max(round_no) n, (array_agg(id order by round_no desc))[1] last_id
  from public.offer_rounds group by offer_id
) r
where r.offer_id = o.id and (o.round_count is distinct from r.n or o.last_round_id is distinct from r.last_id);

-- The floor a move is checked against: the seller's private minimum. A2
-- raises it to the mandate's minimum when that is stricter.
create or replace function public.offer_effective_floor(p_listing uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select t.offer_floor_cents from public.listing_private_terms t where t.listing_id = p_listing;
$function$;

revoke all on function public.offer_effective_floor(uuid) from public, anon, authenticated;

create or replace function public.offer_open(p_offer uuid, p_listing uuid, p_amount integer, p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_listing public.listings;
  v_existing public.offers;
  v_first public.offer_rounds;
  v_opening public.messages;
  v_floor integer;
  v_used integer;
  v_round uuid;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_offer is null or p_listing is null or p_amount is null or p_amount <= 0 or p_amount > 100000000 then
    raise exception 'Invalid offer request' using errcode = '22023';
  end if;
  if p_message is not null and (p_message = '' or p_message <> btrim(p_message) or length(p_message) > 2000) then
    raise exception 'Invalid offer message' using errcode = '22023';
  end if;

  -- An exact retry of a committed opening offer replays it.
  select * into v_existing from public.offers where id = p_offer;
  if found then
    select * into v_first from public.offer_rounds where offer_id = p_offer and round_no = 1;
    if v_existing.buyer_id <> v_actor or v_existing.listing_id <> p_listing
       or v_first.amount_cents is distinct from p_amount then
      raise exception 'Offer retry identity changed' using errcode = '23505';
    end if;
    if v_first.kind = 'offer' then
      select * into v_opening from public.messages where id = p_offer;
      if (p_message is null) is distinct from (not found)
         or (found and (v_opening.sender_id <> v_actor or v_opening.body <> p_message)) then
        raise exception 'Offer retry message changed' using errcode = '23505';
      end if;
    end if;
    return jsonb_build_object('offer_id', p_offer, 'replayed', true,
      'outcome', case when v_first.kind = 'below_minimum' then 'below_minimum' else 'sent' end);
  end if;

  perform set_config('drvn.offer_move', 'on', true);
  select * into v_listing from public.listings where id = p_listing for update;
  if not found or v_listing.status <> 'active' then raise exception 'Listing is not available' using errcode = 'OF007'; end if;
  if v_listing.seller_id = v_actor then raise exception 'You can''t offer on your own listing' using errcode = '42501'; end if;
  if public.is_suspended(v_actor) then raise exception 'account is suspended' using errcode = '42501'; end if;
  if v_listing.shipping_mode = 'drvn' then raise exception 'Offers are unavailable with rated shipping' using errcode = 'OF007'; end if;
  if p_amount > v_listing.price_cents then raise exception 'An offer can''t be above the asking price' using errcode = 'OF004'; end if;
  if exists (select 1 from public.offers o where o.listing_id = p_listing and o.buyer_id = v_actor and o.status in ('open', 'countered')) then
    raise exception 'You already have a live offer on this part' using errcode = '23505';
  end if;
  select count(*) into v_used from public.offer_rounds r
  where r.listing_id = p_listing and r.buyer_id = v_actor and r.actor_role = 'buyer' and r.kind in ('offer', 'counter', 'below_minimum');
  if v_used >= 3 then raise exception 'No offers left on this part' using errcode = 'OF001'; end if;
  if not public.consume_rate_limit('offer-move:' || v_actor, 30, interval '10 minutes') then
    raise exception 'Too many offer moves; try again shortly' using errcode = 'OF009';
  end if;

  v_floor := public.offer_effective_floor(p_listing);
  if v_floor is not null and p_amount < v_floor then
    -- Declined at once, and it uses one of the buyer's 3. Nothing says why.
    insert into public.offers(id, listing_id, buyer_id, amount_cents, status, responded_at)
    values (p_offer, p_listing, v_actor, p_amount, 'declined', now());
    insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind, amount_cents, actor_member_id, idempotency_key)
    values (p_offer, 1, p_listing, v_actor, 'buyer', 'below_minimum', p_amount, v_actor, 'open:' || p_offer)
    returning id into v_round;
    insert into public.offer_round_terms(round_id, effective_floor_cents) values (v_round, v_floor);
    update public.offers set round_count = 1, last_round_id = v_round where id = p_offer;
    perform set_config('drvn.offer_move', '', true);
    return jsonb_build_object('offer_id', p_offer, 'replayed', false, 'outcome', 'below_minimum');
  end if;

  insert into public.offers(id, listing_id, buyer_id, amount_cents, status, expires_at)
  values (p_offer, p_listing, v_actor, p_amount, 'open', now() + interval '72 hours');
  if p_message is not null then
    insert into public.messages(id, listing_id, offer_id, order_id, sender_id, recipient_id, body)
    values (p_offer, p_listing, p_offer, null, v_actor, v_listing.seller_id, p_message);
  end if;
  insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind, amount_cents, expires_at, actor_member_id, idempotency_key)
  values (p_offer, 1, p_listing, v_actor, 'buyer', 'offer', p_amount, now() + interval '72 hours', v_actor, 'open:' || p_offer)
  returning id into v_round;
  insert into public.offer_round_terms(round_id, effective_floor_cents) values (v_round, v_floor);
  update public.offers set round_count = 1, last_round_id = v_round where id = p_offer;
  perform set_config('drvn.offer_move', '', true);
  return jsonb_build_object('offer_id', p_offer, 'replayed', false, 'outcome', 'sent');
end;
$function$;

revoke all on function public.offer_open(uuid, uuid, integer, text) from public, anon;
grant execute on function public.offer_open(uuid, uuid, integer, text) to authenticated;

create or replace function public.offer_move(p_offer uuid, p_kind text, p_amount integer, p_idempotency_key text, p_expected_round integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_prior public.offer_rounds;
  v_listing_id uuid;
  v_listing public.listings;
  v_offer public.offers;
  v_role text;
  v_turn text;
  v_floor integer;
  v_used integer;
  v_no integer;
  v_round uuid;
  v_kind text := p_kind;
  v_amount integer;
  v_expires timestamptz;
  v_order uuid;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_offer is null or p_kind not in ('counter', 'accept', 'decline', 'withdraw')
     or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200
     or (p_kind = 'counter' and (p_amount is null or p_amount <= 0 or p_amount > 100000000)) then
    raise exception 'Invalid offer move' using errcode = '22023';
  end if;

  -- An exact retry replays the move it already made.
  select * into v_prior from public.offer_rounds where actor_member_id = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_prior.offer_id <> p_offer then raise exception 'Move retry identity changed' using errcode = '23505'; end if;
    return jsonb_build_object('offer_id', p_offer, 'round_no', v_prior.round_no, 'kind', v_prior.kind, 'replayed', true,
      'order_id', (select o.id from public.orders o where o.origin_offer_id = p_offer and v_prior.kind = 'accept'));
  end if;

  select o.listing_id into v_listing_id from public.offers o where o.id = p_offer;
  if not found then raise exception 'Offer not found' using errcode = 'P0002'; end if;
  perform set_config('drvn.offer_move', 'on', true);
  select * into v_listing from public.listings where id = v_listing_id for update;
  select * into v_offer from public.offers where id = p_offer for update;
  v_role := case when v_offer.buyer_id = v_actor then 'buyer' when v_listing.seller_id = v_actor then 'seller' end;
  if v_role is null then raise exception 'Offer not found' using errcode = 'P0002'; end if;
  if public.is_suspended(v_actor) then raise exception 'account is suspended' using errcode = '42501'; end if;
  if v_offer.status not in ('open', 'countered') then raise exception 'This offer is already settled' using errcode = 'OF005'; end if;
  if v_offer.round_count is distinct from p_expected_round then
    raise exception 'This offer changed; reload it' using errcode = 'OF003';
  end if;

  v_no := v_offer.round_count + 1;
  -- The turn ran out: record the expiry and say so (it commits).
  if v_offer.expires_at is not null and v_offer.expires_at < now() then
    update public.offers set status = 'expired', responded_at = now() where id = p_offer;
    insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind)
    values (p_offer, v_no, v_listing.id, v_offer.buyer_id, 'system', 'expire') returning id into v_round;
    update public.offers set round_count = v_no, last_round_id = v_round where id = p_offer;
    perform set_config('drvn.offer_move', '', true);
    return jsonb_build_object('offer_id', p_offer, 'round_no', v_no, 'kind', 'expire', 'outcome', 'expired', 'replayed', false);
  end if;

  v_turn := case v_offer.status when 'open' then 'seller' else 'buyer' end;

  if p_kind = 'withdraw' then
    if v_role <> 'buyer' then raise exception 'Only the buyer can withdraw' using errcode = '42501'; end if;
    update public.offers set status = 'withdrawn', responded_at = now() where id = p_offer;
  elsif p_kind = 'decline' then
    if v_role <> 'seller' then raise exception 'Only the seller can decline' using errcode = '42501'; end if;
    update public.offers set status = 'declined', responded_at = now() where id = p_offer;
  elsif p_kind = 'accept' then
    if v_role <> v_turn then raise exception 'It''s not your turn' using errcode = 'OF002'; end if;
    v_amount := case v_role when 'seller' then v_offer.amount_cents else v_offer.counter_amount_cents end;
    -- Under the listing and offer locks taken above; it locks nothing new
    -- before the order it creates.
    v_order := public.offer_accept_begin(p_offer, v_listing.seller_id);
    if v_order is null then raise exception 'This part is no longer available' using errcode = 'OF007'; end if;
  else
    if v_role <> v_turn then raise exception 'It''s not your turn' using errcode = 'OF002'; end if;
    if not public.consume_rate_limit('offer-move:' || v_actor, 30, interval '10 minutes') then
      raise exception 'Too many offer moves; try again shortly' using errcode = 'OF009';
    end if;
    v_floor := public.offer_effective_floor(v_listing.id);
    v_amount := p_amount;
    v_expires := now() + interval '72 hours';
    if v_role = 'seller' then
      if p_amount <= v_offer.amount_cents or p_amount > v_listing.price_cents or (v_floor is not null and p_amount < v_floor) then
        raise exception 'A counter must be above the offer, no more than the asking price and no less than your minimum' using errcode = 'OF004';
      end if;
      update public.offers set status = 'countered', counter_amount_cents = p_amount, countered_at = now(), expires_at = v_expires
      where id = p_offer;
    else
      if p_amount <= v_offer.amount_cents or p_amount >= v_offer.counter_amount_cents then
        raise exception 'A counter-offer must be above your last offer and below the seller''s counter' using errcode = 'OF004';
      end if;
      select count(*) into v_used from public.offer_rounds r
      where r.listing_id = v_listing.id and r.buyer_id = v_actor and r.actor_role = 'buyer' and r.kind in ('offer', 'counter', 'below_minimum');
      if v_used >= 3 then raise exception 'No offers left on this part' using errcode = 'OF001'; end if;
      if v_floor is not null and p_amount < v_floor then
        v_kind := 'below_minimum';
        v_expires := null;
        update public.offers set status = 'declined', amount_cents = p_amount, counter_amount_cents = null, responded_at = now()
        where id = p_offer;
      else
        update public.offers set status = 'open', amount_cents = p_amount, counter_amount_cents = null, countered_at = null, expires_at = v_expires
        where id = p_offer;
      end if;
    end if;
  end if;

  insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind, amount_cents, expires_at, actor_member_id, idempotency_key)
  values (p_offer, v_no, v_listing.id, v_offer.buyer_id, v_role, v_kind, v_amount,
          case when v_kind = 'counter' then v_expires end, v_actor, p_idempotency_key)
  returning id into v_round;
  if v_kind in ('counter', 'below_minimum') then
    insert into public.offer_round_terms(round_id, effective_floor_cents) values (v_round, v_floor);
  end if;
  update public.offers set round_count = v_no, last_round_id = v_round where id = p_offer;
  perform set_config('drvn.offer_move', '', true);
  return jsonb_build_object('offer_id', p_offer, 'round_no', v_no, 'kind', v_kind, 'replayed', false,
    'outcome', case when v_kind = 'below_minimum' then 'below_minimum' else 'done' end, 'order_id', v_order);
end;
$function$;

revoke all on function public.offer_move(uuid, text, integer, text, integer) from public, anon;
grant execute on function public.offer_move(uuid, text, integer, text, integer) to authenticated;

-- record_offer_round (20261017150000): skips moves offer_move writes, and keeps round_count current.
CREATE OR REPLACE FUNCTION public.record_offer_round()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_seller uuid;
  v_kind text;
  v_role text;
  v_actor uuid;
  v_amount integer;
  v_expires timestamptz;
  v_round uuid;
  v_no integer;
begin
  -- offer_open / offer_move write their own rounds (20261017160000).
  if current_setting('drvn.offer_move', true) = 'on' then return null; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  select l.seller_id into v_seller from public.listings l where l.id = new.listing_id;

  if tg_op = 'INSERT' then
    v_kind := 'offer'; v_role := 'buyer'; v_actor := new.buyer_id;
    v_amount := new.amount_cents; v_expires := new.expires_at;
  elsif new.status = 'countered' then
    v_kind := 'counter'; v_role := 'seller'; v_actor := v_seller;
    v_amount := new.counter_amount_cents; v_expires := new.expires_at;
  elsif new.status = 'accepted' then
    -- The seller accepts the buyer's amount; the buyer accepts a counter.
    v_kind := 'accept';
    if old.status = 'countered' then v_role := 'buyer'; v_actor := new.buyer_id;
    else v_role := 'seller'; v_actor := v_seller; end if;
    v_amount := coalesce(new.counter_amount_cents, new.amount_cents);
  elsif new.status = 'declined' then
    v_kind := 'decline'; v_role := 'seller'; v_actor := v_seller;
  elsif new.status = 'withdrawn' then
    v_kind := 'withdraw'; v_role := 'buyer'; v_actor := new.buyer_id;
  elsif new.status = 'expired' then
    v_kind := 'expire'; v_role := 'system'; v_actor := null;
  else
    return null;
  end if;

  -- One writer per offer at a time: the offer row is already locked by the
  -- statement that fired this trigger.
  select coalesce(max(r.round_no), 0) + 1 into v_no from public.offer_rounds r where r.offer_id = new.id;
  insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind, amount_cents, expires_at, actor_member_id)
  values (new.id, v_no, new.listing_id, new.buyer_id, v_role, v_kind, v_amount, v_expires, v_actor)
  returning id into v_round;
  update public.offers set round_count = v_no, last_round_id = v_round where id = new.id;

  -- A proposal (opening offer or counter) keeps the seller's minimum in force
  -- at the time, so a later change can't rewrite what was agreed.
  if v_kind in ('offer', 'counter') then
    insert into public.offer_round_terms(round_id, effective_floor_cents)
    select v_round, t.offer_floor_cents from public.listing_private_terms t where t.listing_id = new.listing_id;
  end if;
  return null;
end;
$function$;

-- guard_offer_private_floor (20261017130000): offer_open / offer_move check the minimum themselves.
CREATE OR REPLACE FUNCTION public.guard_offer_private_floor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_floor integer;
begin
  -- offer_open / offer_move check the minimum themselves and record a
  -- below-minimum attempt as a declined round (20261017160000).
  if current_setting('drvn.offer_move', true) = 'on' then return new; end if;
  -- Same trust rule as is_trusted_writer() for the service role. (Inside a
  -- definer function current_user is the owner, so only the JWT role can
  -- say who called.)
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role' then
    return new;
  end if;
  select t.offer_floor_cents into v_floor from public.listing_private_terms t where t.listing_id = new.listing_id;
  if v_floor is not null and new.amount_cents < v_floor then
    raise exception 'That offer is lower than the seller will accept' using errcode = '23514';
  end if;
  return new;
end;
$function$;

-- notify_on_offer: an attempt declined at once is not announced.
CREATE OR REPLACE FUNCTION public.notify_on_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_seller uuid;
  v_title text;
begin
  -- An attempt declined at once (below the minimum) isn't news (20261017160000).
  if new.status <> 'open' then return new; end if;
  select l.seller_id, l.title into v_seller, v_title
  from public.listings l where l.id = new.listing_id;

  perform public.notify(
    v_seller, 'offer_new', 'marketplace',
    'New offer on ' || v_title,
    to_char(new.amount_cents / 100.0, 'FM999,999,990.00'),
    '/offers/' || new.id, new.buyer_id
  );
  return new;
end;
$function$;

-- notify_on_offer_response: adds offer_countered_back (seller) and offer_expired (both).
CREATE OR REPLACE FUNCTION public.notify_on_offer_response()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_seller uuid;
  v_listing_title text;
  v_order uuid;
begin
  if new.status = old.status then
    return new;
  end if;

  select l.seller_id, l.title into v_seller, v_listing_title
  from public.listings l where l.id = new.listing_id;

  -- Buyer-facing outcomes. A seller's acceptance is announced by the app,
  -- with the checkout link the buyer needs.
  if new.status in ('declined', 'countered') then
    perform public.notify(
      new.buyer_id, 'offer_' || new.status, 'marketplace',
      case new.status
        when 'declined' then 'Your offer was declined'
        else 'The seller countered your offer'
      end,
      v_listing_title, '/offers/' || new.id, v_seller
    );
  end if;

  -- Seller-facing: the buyer took the seller's counter.
  if new.status = 'accepted' and new.counter_amount_cents is not null then
    select o.id into v_order from public.orders o where o.origin_offer_id = new.id;
    perform public.notify(
      v_seller, 'offer_counter_accepted', 'marketplace',
      'Your counter was accepted', v_listing_title,
      coalesce('/orders/' || v_order, '/offers/' || new.id), new.buyer_id
    );
  end if;

  -- Seller-facing: the buyer countered back (negotiation v2).
  if new.status = 'open' and old.status = 'countered' then
    perform public.notify(
      v_seller, 'offer_countered_back', 'marketplace',
      'The buyer countered your offer', v_listing_title, '/offers/' || new.id, new.buyer_id
    );
  end if;

  -- Both sides: the turn ran out (20261017160000).
  if new.status = 'expired' then
    perform public.notify(
      new.buyer_id, 'offer_expired', 'marketplace',
      'Your offer expired', v_listing_title, '/offers/' || new.id, null
    );
    perform public.notify(
      v_seller, 'offer_expired', 'marketplace',
      'An offer expired', v_listing_title, '/offers/' || new.id, null
    );
  end if;

  -- Seller-facing: the buyer walked away.
  if new.status = 'withdrawn' then
    perform public.notify(
      v_seller, 'offer_withdrawn', 'marketplace',
      'An offer was withdrawn', v_listing_title, '/offers/' || new.id, new.buyer_id
    );
  end if;

  return new;
end;
$function$;

-- settle_seller_cancellation (20260905225925): refuses once checkout has begun.
CREATE OR REPLACE FUNCTION public.settle_seller_cancellation(p_order uuid, p_actor uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  o public.orders;
  payment public.payments;
  listing_ids uuid[];
  bad_listings integer;
  reason text:=coalesce(nullif(left(trim(coalesce(p_reason,'')),500),''),'cancelled by seller');
begin
  if p_order is null or p_actor is null then raise exception 'Order and actor are required'; end if;
  select * into strict o from public.orders where id=p_order for update;
  if o.seller_id is distinct from p_actor then raise exception 'Seller authorization required' using errcode='42501'; end if;

  select coalesce(array_agg(listing_id order by listing_id),array[]::uuid[])
  into listing_ids from public.order_items where order_id=o.id and listing_id is not null;
  if cardinality(listing_ids)=0 then raise exception 'Order has no inventory items'; end if;
  perform 1 from public.listings where id=any(listing_ids) order by id for update;

  if o.seller_cancellation_relisted_at is not null then
    return jsonb_build_object('ok',true,'complete',true,'replayed',true,'status',o.status);
  end if;
  select * into payment from public.payments where order_id=o.id for update;

  -- Cancel only before checkout begins (negotiation v2, O-5): once the buyer
  -- has frozen the accepted offer's delivery, the order runs its course.
  if o.status='pending' and o.accepted_checkout_shipping is not null then
    return jsonb_build_object('ok',false,'complete',false,'reason','The buyer has started checkout, so this order can no longer be cancelled.');
  end if;

  if o.status='pending' then
    if not found or payment.status not in ('pending','failed') or payment.provider_reference is not null
       or exists(
         select 1 from public.payment_requests request
         where request.request->'orderIds' ? o.id::text
       ) then
      return jsonb_build_object('ok',false,'complete',false,'reason','Payment state requires reconciliation before cancellation.');
    end if;
    update public.orders set status='cancelled',cancelled_at=coalesce(cancelled_at,now()),
      cancel_reason=reason,seller_cancellation_relisted_at=now() where id=o.id;
    update public.listings set status='active',sold_at=null,reserved_until=null
      where id=any(listing_ids) and status='reserved';
  elsif o.status='paid' then
    return jsonb_build_object('ok',true,'complete',false,'needs_refund',true,'status',o.status);
  elsif o.status='refunded' then
    if not found or payment.status<>'refunded' or payment.refunded_cents<payment.amount_cents
       or not exists(
         select 1 from public.refund_operations r where r.order_id=o.id
         and r.requested_by='seller:'||p_actor::text
         and r.status in ('completed','recovery_required')
       ) then
      raise exception 'Seller cancellation refund is not durably complete';
    end if;
    update public.listings set status='active',sold_at=null,reserved_until=null
      where id=any(listing_ids) and status='sold';
    update public.orders set cancel_reason=coalesce(cancel_reason,reason),
      cancelled_at=coalesce(cancelled_at,now()),seller_cancellation_relisted_at=now()
      where id=o.id;
  elsif o.status='cancelled' and found and payment.provider_reference is null then
    update public.listings set status='active',sold_at=null,reserved_until=null
      where id=any(listing_ids) and status='reserved';
    update public.orders set cancel_reason=coalesce(cancel_reason,reason),
      cancelled_at=coalesce(cancelled_at,now()),seller_cancellation_relisted_at=now()
      where id=o.id;
  else
    return jsonb_build_object('ok',false,'complete',false,'status',o.status,'reason','This order cannot be cancelled by the seller.');
  end if;

  select count(*) into bad_listings from public.listings where id=any(listing_ids) and status<>'active';
  if bad_listings<>0 then raise exception 'Cancellation inventory could not be released safely'; end if;
  return jsonb_build_object('ok',true,'complete',true,'replayed',false,'status',(select status from public.orders where id=o.id));
end $function$;

commit;
