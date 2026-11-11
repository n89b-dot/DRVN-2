-- 20261017130000 — the offer minimum lives only in listing_private_terms
-- (A0, step two of three: switch).
--
-- After 20261017120000 the private table holds every minimum, kept equal to
-- listings.offer_floor_cents by a mirror trigger. This file makes the private
-- table the only home while the old column still exists, so old and new app
-- versions both keep working and neither exposes the minimum:
--
--   * listings.offer_floor_cents is emptied and must stay empty (a check
--     constraint). Any write that still sets it — the sell and edit
--     functions, an older app build, a script — is caught by a BEFORE trigger
--     that moves the value into listing_private_terms and stores null. The
--     trigger fires only when offer_floor_cents is named in the write, so a
--     status or price change never clears a minimum.
--   * "Minimum at or below the price" moves with it. listings' own check
--     can't see the private table, so it is enforced from both sides: setting
--     a minimum above the price, and cutting the price below the minimum
--     (and a service-role write to the private table).
--   * Offer checks read the private table. guard_offer_insert and
--     create_offer_with_message run with the caller's rights, which can't read
--     it, so the minimum is checked by a new SECURITY DEFINER trigger on
--     offers. The refusal no longer names the number.
--   * save_listing_creation's replay check compares the minimum through
--     my_listing_offer_floor instead of the (now empty) column.
--
-- Visible change: buyers no longer see "Offers accepted from $X". The PRD
-- makes a public minimum the seller's choice, off by default (O-3); that
-- toggle ships with negotiation v2. Until then every minimum is private.
--
-- The FK from listing_private_terms to listings becomes deferred so the
-- BEFORE INSERT trigger can write the private row before its listing row
-- exists; it is checked at commit.
--
-- Step three (contract) drops listings.offer_floor_cents, this file's absorb
-- trigger and the check, after the switched app is live everywhere. The sell
-- and edit functions then write the private table directly.
-- Idempotent.

begin;

alter table public.listing_private_terms
  alter constraint listing_private_terms_listing_id_fkey deferrable initially deferred;

-- The expand step's mirror copied listings -> private on every write. It is
-- replaced by the absorb trigger below; drop it first, so emptying the old
-- column can't copy nulls over the private minimums.
drop trigger if exists listings_mirror_private_terms on public.listings;
drop function if exists public.mirror_listing_private_terms();

-- Catch up anything written between the two steps, then empty the column.
insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents)
select l.id, l.seller_id, l.offer_floor_cents
from public.listings l
where l.offer_floor_cents is not null
on conflict (listing_id) do update
  set offer_floor_cents = excluded.offer_floor_cents, updated_at = now()
where listing_private_terms.offer_floor_cents is distinct from excluded.offer_floor_cents;
insert into public.listing_private_terms(listing_id, seller_id)
select l.id, l.seller_id from public.listings l
on conflict (listing_id) do nothing;
update public.listings set offer_floor_cents = null where offer_floor_cents is not null;

-- Writes to listings.offer_floor_cents land in the private table.
create or replace function public.absorb_listing_offer_floor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_floor integer := new.offer_floor_cents;
begin
  new.offer_floor_cents := null;
  -- An insert whose id already exists is a conflict (skipped or refused),
  -- never a write to that listing: it must not touch the existing row's
  -- private terms.
  if tg_op = 'INSERT' and exists (select 1 from public.listings where id = new.id) then
    return new;
  end if;
  if v_floor is not null and (v_floor <= 0 or v_floor > new.price_cents) then
    raise exception 'The offer minimum must be above zero and no more than the asking price'
      using errcode = '23514';
  end if;
  -- Checked above against the price being written; the private table's own
  -- bound check would see the old price mid-update, so it skips this row.
  perform set_config('drvn.floor_checked_listing', new.id::text, true);
  if tg_op = 'INSERT' then
    insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents)
    values (new.id, new.seller_id, v_floor)
    on conflict (listing_id) do nothing;
  else
    insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents)
    values (new.id, new.seller_id, v_floor)
    on conflict (listing_id) do update
      set offer_floor_cents = excluded.offer_floor_cents,
          seller_id = excluded.seller_id,
          updated_at = now();
  end if;
  perform set_config('drvn.floor_checked_listing', '', true);
  return new;
end;
$function$;

revoke all on function public.absorb_listing_offer_floor() from public, anon, authenticated;

-- Named to run after every other BEFORE trigger on listings, so no later
-- trigger can skip the row after its private terms were written.
drop trigger if exists listings_zz1_absorb_offer_floor on public.listings;
create trigger listings_zz1_absorb_offer_floor
  before insert or update of offer_floor_cents on public.listings
  for each row execute function public.absorb_listing_offer_floor();

-- A price cut can't go below the minimum; the private row follows the seller.
-- Runs after the absorb trigger, so an edit that changes both checks the new
-- minimum against the new price.
create or replace function public.guard_listing_price_above_floor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_floor integer;
begin
  if new.seller_id is distinct from old.seller_id then
    update public.listing_private_terms set seller_id = new.seller_id, updated_at = now()
    where listing_id = new.id;
  end if;
  if new.price_cents is distinct from old.price_cents then
    select t.offer_floor_cents into v_floor from public.listing_private_terms t where t.listing_id = new.id;
    if v_floor is not null and v_floor > new.price_cents then
      raise exception 'The asking price can''t go below your offer minimum; lower the minimum first'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_listing_price_above_floor() from public, anon, authenticated;

drop trigger if exists listings_zz2_price_above_floor on public.listings;
create trigger listings_zz2_price_above_floor
  before update of price_cents, seller_id on public.listings
  for each row execute function public.guard_listing_price_above_floor();

-- The same bound from the private side (service-role writes).
create or replace function public.guard_private_floor_within_price()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_price integer;
begin
  if new.offer_floor_cents is null
     or current_setting('drvn.floor_checked_listing', true) = new.listing_id::text then
    return new;
  end if;
  select l.price_cents into v_price from public.listings l where l.id = new.listing_id;
  -- No listing row yet: the absorb trigger is writing ahead of the insert and
  -- has already checked the bound.
  if found and new.offer_floor_cents > v_price then
    raise exception 'The offer minimum must be no more than the asking price'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_private_floor_within_price() from public, anon, authenticated;

drop trigger if exists listing_private_terms_within_price on public.listing_private_terms;
create trigger listing_private_terms_within_price
  before insert or update of offer_floor_cents on public.listing_private_terms
  for each row execute function public.guard_private_floor_within_price();

-- The old column stays empty from now on.
alter table public.listings drop constraint if exists listings_offer_floor_private;
alter table public.listings
  add constraint listings_offer_floor_private check (offer_floor_cents is null);

comment on column public.listings.offer_floor_cents is
  'Retired: always null. The offer minimum lives in listing_private_terms (20261017130000); dropped in the contract step.';

-- Offers below the minimum are refused, without saying what it is.
create or replace function public.guard_offer_private_floor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_floor integer;
begin
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

revoke all on function public.guard_offer_private_floor() from public, anon, authenticated;

drop trigger if exists offers_guard_private_floor on public.offers;
create trigger offers_guard_private_floor
  before insert on public.offers
  for each row execute function public.guard_offer_private_floor();

-- guard_offer_insert: unchanged except that it no longer reads the minimum.
CREATE OR REPLACE FUNCTION public.guard_offer_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_listing record;
begin
  if public.is_trusted_writer() then
    return new;
  end if;

  -- A buyer opens an offer. Countering is the seller's move and runs
  -- server-side, so neither the countered state nor its amount may be
  -- self-assigned.
  if new.status is distinct from 'open' then
    raise exception 'a new offer must start as open' using errcode = '42501';
  end if;
  if new.counter_amount_cents is not null or new.countered_at is not null then
    raise exception 'only the seller can counter, and not at offer time'
      using errcode = '42501';
  end if;
  if new.responded_at is not null then
    raise exception 'responded_at is set when the seller responds'
      using errcode = '42501';
  end if;

  select id, seller_id, status, price_cents
  into v_listing
  from public.listings
  where id = new.listing_id;

  if not found or v_listing.status <> 'active' then
    raise exception 'that part is not on sale' using errcode = '42501';
  end if;
  if v_listing.seller_id = new.buyer_id then
    raise exception 'you cannot offer on your own listing' using errcode = '42501';
  end if;
  if new.amount_cents > v_listing.price_cents then
    raise exception 'an offer cannot exceed the asking price' using errcode = '42501';
  end if;
  -- The seller's minimum is private (20261017120000): this invoker-rights
  -- guard can't read it, so offers_guard_private_floor checks it.

  -- One live offer per buyer per listing.
  if exists (
    select 1 from public.offers o
    where o.listing_id = new.listing_id
      and o.buyer_id = new.buyer_id
      and o.status in ('open', 'countered')
  ) then
    raise exception 'you already have a live offer on this part' using errcode = '42501';
  end if;

  -- The window is the platform's to set, not the buyer's.
  new.expires_at := now() + interval '72 hours';

  return new;
end;
$function$;

-- create_offer_with_message: unchanged except that the minimum check moved to the trigger.
CREATE OR REPLACE FUNCTION public.create_offer_with_message(p_offer uuid, p_listing uuid, p_amount integer, p_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid:=auth.uid();
  listing public.listings;
  existing public.offers;
  opening public.messages;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_offer is null or p_listing is null or p_amount is null or p_amount<=0 or p_amount>100000000 then
    raise exception 'Invalid offer request';
  end if;
  if p_message is not null and (p_message='' or p_message<>btrim(p_message) or length(p_message)>2000) then
    raise exception 'Invalid offer message';
  end if;

  select * into existing from public.offers where id=p_offer;
  if found then
    if existing.buyer_id<>actor or existing.listing_id<>p_listing or existing.amount_cents<>p_amount then
      raise exception 'Offer retry identity changed' using errcode='23505';
    end if;
    select * into opening from public.messages where id=p_offer;
    if p_message is null then
      if found then raise exception 'Offer retry message changed'; end if;
    elsif not found or opening.sender_id<>actor or opening.offer_id<>p_offer
       or opening.listing_id is distinct from p_listing or opening.order_id is not null
       or opening.body<>p_message then
      raise exception 'Offer retry message changed';
    end if;
    return jsonb_build_object('offer_id',existing.id,'replayed',true);
  end if;

  select * into listing from public.listings where id=p_listing;
  if not found or listing.status<>'active' then raise exception 'Listing is not available'; end if;
  if listing.seller_id=actor then raise exception 'Buyer cannot offer on own listing'; end if;
  if listing.shipping_mode='drvn' then raise exception 'Offers are unavailable with rated shipping'; end if;
  if p_amount>listing.price_cents then raise exception 'Offer exceeds asking price'; end if;
  -- The seller's minimum is private (20261017120000) and is enforced by the
  -- offers_guard_private_floor trigger on the insert below.

  insert into public.offers(id,listing_id,buyer_id,amount_cents)
  values(p_offer,p_listing,actor,p_amount)
  returning * into existing;
  if p_message is not null then
    insert into public.messages(
      id,listing_id,offer_id,order_id,sender_id,recipient_id,body
    ) values(p_offer,p_listing,p_offer,null,actor,listing.seller_id,p_message);
  end if;
  return jsonb_build_object('offer_id',existing.id,'replayed',false);
end $function$;

-- save_listing_creation (20260919190500): unchanged except the replay check reads the
-- minimum through my_listing_offer_floor; the insert still names the old column, which the
-- absorb trigger empties.
CREATE OR REPLACE FUNCTION public.save_listing_creation(p_request uuid, p_payload_hash text, p_listing jsonb, p_images jsonb, p_fitments jsonb, p_alt_numbers jsonb, p_mod_item uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_claim jsonb;
  v_id uuid;
  v_existing public.listings%rowtype;
  v_status text;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode='42501'; end if;
  if jsonb_typeof(p_listing) is distinct from 'object'
     or jsonb_typeof(p_images) is distinct from 'array'
     or jsonb_typeof(p_fitments) is distinct from 'array'
     or jsonb_typeof(p_alt_numbers) is distinct from 'array'
     or jsonb_array_length(p_images) > 12
     or jsonb_array_length(p_fitments) > 10
     or jsonb_array_length(p_alt_numbers) > 5 then
    raise exception 'Invalid listing projection' using errcode='22023';
  end if;
  v_status := p_listing->>'status';
  if v_status not in ('draft','active') then
    raise exception 'Invalid initial listing status' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_request::text, 0));
  v_claim := public.claim_listing_creation(p_request,p_payload_hash);
  v_id := (v_claim->>'listing_id')::uuid;
  if (v_claim->>'completed')::boolean then
    return jsonb_build_object('listing_id',v_id,'completed',true,'replayed',true);
  end if;

  insert into public.listings(
    id,seller_id,source_car_id,title,description,category,subcategory,condition,
    grade,condition_checklist,price_cents,shipping_cents,shipping_mode,
    weight_oz,length_in,width_in,height_in,offer_floor_cents,allows_collection,
    location,compatibility_notes,part_number,status,
    brand,part_miles,part_miles_unit
  ) values (
    v_id,v_actor,nullif(p_listing->>'source_car_id','')::uuid,
    p_listing->>'title',nullif(p_listing->>'description',''),p_listing->>'category',
    nullif(p_listing->>'subcategory',''),nullif(p_listing->>'condition',''),
    nullif(p_listing->>'grade',''),nullif(p_listing->'condition_checklist','null'::jsonb),
    (p_listing->>'price_cents')::integer,(p_listing->>'shipping_cents')::integer,
    p_listing->>'shipping_mode',nullif(p_listing->>'weight_oz','')::numeric,
    nullif(p_listing->>'length_in','')::numeric,nullif(p_listing->>'width_in','')::numeric,
    nullif(p_listing->>'height_in','')::numeric,nullif(p_listing->>'offer_floor_cents','')::integer,
    (p_listing->>'allows_collection')::boolean,nullif(p_listing->>'location',''),
    nullif(p_listing->>'compatibility_notes',''),nullif(p_listing->>'part_number',''),v_status,
    nullif(btrim(p_listing->>'brand'),''),
    nullif(p_listing->>'part_miles','')::integer,
    nullif(p_listing->>'part_miles_unit','')
  ) on conflict(id) do nothing;

  select * into strict v_existing from public.listings where id=v_id for update;
  if v_existing.seller_id is distinct from v_actor
     or v_existing.source_car_id is distinct from nullif(p_listing->>'source_car_id','')::uuid
     or v_existing.title is distinct from p_listing->>'title'
     or v_existing.description is distinct from nullif(p_listing->>'description','')
     or v_existing.category is distinct from p_listing->>'category'
     or v_existing.subcategory is distinct from nullif(p_listing->>'subcategory','')
     or v_existing.condition is distinct from nullif(p_listing->>'condition','')
     or v_existing.grade is distinct from nullif(p_listing->>'grade','')
     or v_existing.condition_checklist is distinct from nullif(p_listing->'condition_checklist','null'::jsonb)
     or v_existing.price_cents is distinct from (p_listing->>'price_cents')::integer
     or v_existing.shipping_cents is distinct from (p_listing->>'shipping_cents')::integer
     or v_existing.shipping_mode is distinct from p_listing->>'shipping_mode'
     or v_existing.weight_oz is distinct from nullif(p_listing->>'weight_oz','')::numeric
     or v_existing.length_in is distinct from nullif(p_listing->>'length_in','')::numeric
     or v_existing.width_in is distinct from nullif(p_listing->>'width_in','')::numeric
     or v_existing.height_in is distinct from nullif(p_listing->>'height_in','')::numeric
     or public.my_listing_offer_floor(v_id) is distinct from nullif(p_listing->>'offer_floor_cents','')::integer
     or v_existing.allows_collection is distinct from (p_listing->>'allows_collection')::boolean
     or v_existing.location is distinct from nullif(p_listing->>'location','')
     or v_existing.compatibility_notes is distinct from nullif(p_listing->>'compatibility_notes','')
     or v_existing.part_number is distinct from nullif(p_listing->>'part_number','')
     or v_existing.brand is distinct from nullif(btrim(p_listing->>'brand'),'')
     or v_existing.part_miles is distinct from nullif(p_listing->>'part_miles','')::integer
     or v_existing.part_miles_unit is distinct from nullif(p_listing->>'part_miles_unit','')
     or v_existing.status is distinct from v_status then
    raise exception 'Listing changed after this request began; refresh before continuing'
      using errcode='40001';
  end if;

  delete from public.listing_images where listing_id=v_id;
  insert into public.listing_images(listing_id,url,alt,position)
  select v_id,item->>'url',nullif(item->>'alt',''),ordinality-1
  from jsonb_array_elements(p_images) with ordinality as image(item,ordinality);

  delete from public.listing_fitments where listing_id=v_id;
  insert into public.listing_fitments(listing_id,make,model,year_start,year_end)
  select v_id,item->>'make',item->>'model',nullif(item->>'year_start','')::integer,
         nullif(item->>'year_end','')::integer
  from jsonb_array_elements(p_fitments) as fitment(item);

  delete from public.listing_part_numbers where listing_id=v_id;
  insert into public.listing_part_numbers(listing_id,number)
  select v_id,value from jsonb_array_elements_text(p_alt_numbers) as number(value);

  if p_mod_item is not null and v_existing.source_car_id is not null then
    update public.mod_items m set linked_listing_id=v_id
    where m.id=p_mod_item and m.car_id=v_existing.source_car_id
      and exists(select 1 from public.cars c where c.id=m.car_id and c.owner_id=v_actor);
    if not found then
      raise exception 'Build line does not belong to this listing source car' using errcode='42501';
    end if;
  end if;

  perform public.complete_listing_creation(p_request,p_payload_hash,v_id);
  return jsonb_build_object('listing_id',v_id,'completed',true,'replayed',false);
end;
$function$;

commit;
