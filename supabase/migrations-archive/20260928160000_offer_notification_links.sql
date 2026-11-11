-- Offer notifications open the offer, and say each thing once.
--
-- 1. Every offer notification linked to '/orders' — written when offers
--    lived there. Offers have their own page now, so 'New offer on …',
--    'countered', 'declined' and 'withdrawn' open /offers/<id>.
-- 2. A seller accepting an offer produced two 'Your offer was accepted'
--    rows: this trigger's (to /orders) and the app's own (to checkout,
--    offer-actions.ts notifyOfferAccepted). The trigger now leaves that one
--    to the app.
-- 3. When the BUYER accepts the seller's counter, the trigger told the buyer
--    "Your offer was accepted" and the seller nothing. A seller can no longer
--    accept a countered offer (offer-actions.ts), so an accepted offer with a
--    counter is always the buyer's acceptance: the seller is told, with a
--    link to the order it created.
-- 4. Car follows were stored as kind 'follow', the profile-follow kind, so
--    the "Car follows & saves" switch couldn't mute them and "New followers"
--    muted both. They are 'car_follow' now (mapped in notification-prefs.ts),
--    existing rows included.
--
-- Idempotent: create or replace; the backfill is a no-op on a second run.

begin;

create or replace function public.notify_on_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller uuid;
  v_title text;
begin
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
$$;

create or replace function public.notify_on_offer_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  -- Seller-facing: the buyer walked away.
  if new.status = 'withdrawn' then
    perform public.notify(
      v_seller, 'offer_withdrawn', 'marketplace',
      'An offer was withdrawn', v_listing_title, '/offers/' || new.id, new.buyer_id
    );
  end if;

  return new;
end;
$$;

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_href text;
  v_title text;
  v_kind text;
begin
  if new.target_type = 'profile' then
    v_owner := new.target_id;
    v_kind := 'follow';
    v_title := public.actor_name(new.follower_id) || ' followed you';
    select '/u/' || username into v_href from public.profiles where id = new.follower_id;
  else
    select c.owner_id, '/cars/' || c.slug into v_owner, v_href
    from public.cars c where c.id = new.target_id;
    v_kind := 'car_follow';
    v_title := public.actor_name(new.follower_id) || ' is following your build';
  end if;

  perform public.notify(
    v_owner, v_kind, 'engagement', v_title, null, v_href, new.follower_id
  );
  return new;
end;
$$;

update public.notifications
set kind = 'car_follow'
where kind = 'follow' and href like '/cars/%';

commit;
