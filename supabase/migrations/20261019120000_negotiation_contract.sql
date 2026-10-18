-- 20261019120000 — negotiation v2 and the private minimum: contract
-- (A1 step two's clean-up and A0 step three; docs/decisions/negotiation-v2.md
-- §6, agent-foundations.md §9).
--
-- The switched app (offer_open / offer_move, the sell form and edit page
-- reading the minimum through my_listing_offer_floor) is the only app that
-- runs against this database, so the paths it replaced go:
--
-- Offers
--   * create_offer_with_message is dropped; offer_open replaced it.
--   * Clients can no longer write public.offers: the insert and withdraw
--     policies (and the restrictive suspended-insert policy) are dropped and
--     anon/authenticated keep only SELECT. Every member move goes through
--     offer_open and offer_move; system writers (offer_accept_begin,
--     purchase_finalize, release_expired_reservations) and the service role
--     are unchanged.
--   * guard_offer_private_floor and its trigger are dropped: with no client
--     insert left, only offer_open (which checks the minimum itself) and the
--     service role (which the guard let through) insert offers.
--   * record_offer_round stays. offer_open and offer_move write their own
--     rounds and it skips them, but the expiry sweep, purchase_finalize
--     (closing the other offers on a sold part) and offer_accept_begin on an
--     expired offer still change offers' status without writing a round.
--
-- The minimum
--   * listings.offer_floor_cents, its two check constraints and the absorb
--     trigger that moved writes into listing_private_terms are dropped.
--   * set_listing_offer_floor(listing, floor) writes the minimum. It acts
--     only for the listing's own seller, refuses a suspended seller and a
--     sold, reserved or removed listing, and checks 0 < minimum <= price.
--     save_listing_creation calls it after inserting the listing (not on a
--     replay); update_listing_atomic calls it before or after the listing
--     update, whichever keeps the minimum within the price at every step.
--     Both still read the minimum from the same JSON key, so the form
--     payload is unchanged.
--     Members can execute it: the two functions run with the caller's rights,
--     so a setter they can reach must be. Its reach is what a seller already
--     had through `update listings set offer_floor_cents` on their own
--     listing, without the set_config skip.
--   * The drvn.floor_checked_listing skip goes from the private table's bound
--     check, which now always runs: the setter writes after the listing row
--     has its new price.
--   * The foreign key from listing_private_terms to listings is checked
--     immediately again; nothing writes a private row ahead of its listing.
--   * A listing created other than through the sell form (service-role
--     tools, fixtures) has no private row until a minimum is set; no row
--     means no minimum, as it does to every reader.
--
-- No export contract change: listing_private_terms' exported columns are the
-- same, and listings' projection never carried the minimum.
-- Idempotent.

begin;

-- Offers: one way in. ---------------------------------------------------

drop function if exists public.create_offer_with_message(uuid, uuid, integer, text);

drop policy if exists "buyers create offers" on public.offers;
drop policy if exists "buyers withdraw own offers" on public.offers;
drop policy if exists "suspended members don't make offers" on public.offers;
revoke insert, update, delete, truncate, references, trigger on public.offers from anon, authenticated;

drop trigger if exists offers_guard_private_floor on public.offers;
drop function if exists public.guard_offer_private_floor();

-- The minimum: one home, one writer. -----------------------------------

create or replace function public.set_listing_offer_floor(p_listing uuid, p_floor integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_listing public.listings;
begin
  select * into v_listing from public.listings where id = p_listing for update;
  if not found or v_listing.seller_id is distinct from (select auth.uid()) then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;
  if public.is_suspended(v_listing.seller_id) then
    raise exception 'account is suspended' using errcode = '42501';
  end if;
  if v_listing.status in ('sold', 'reserved', 'removed') then
    raise exception 'A sold, reserved or removed listing can''t be edited' using errcode = '55000';
  end if;
  if p_floor is not null and (p_floor <= 0 or p_floor > v_listing.price_cents) then
    raise exception 'The offer minimum must be above zero and no more than the asking price'
      using errcode = '23514';
  end if;
  insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents)
  values (v_listing.id, v_listing.seller_id, p_floor)
  on conflict (listing_id) do update
    set offer_floor_cents = excluded.offer_floor_cents,
        seller_id = excluded.seller_id,
        updated_at = now();
end;
$function$;

comment on function public.set_listing_offer_floor(uuid, integer) is
  'Sets or clears the seller''s private offer minimum on their own listing (20261019120000).';

revoke all on function public.set_listing_offer_floor(uuid, integer) from public, anon;
grant execute on function public.set_listing_offer_floor(uuid, integer) to authenticated, service_role;

-- save_listing_creation (20261018100000): unchanged except that the minimum is
-- written through set_listing_offer_floor instead of the listings column.
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
  v_inserted integer;
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
    weight_oz,length_in,width_in,height_in,show_offer_floor,allows_collection,
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
    nullif(p_listing->>'height_in','')::numeric,
    coalesce((p_listing->>'show_offer_floor')::boolean,false),
    (p_listing->>'allows_collection')::boolean,nullif(p_listing->>'location',''),
    nullif(p_listing->>'compatibility_notes',''),nullif(p_listing->>'part_number',''),v_status,
    nullif(btrim(p_listing->>'brand'),''),
    nullif(p_listing->>'part_miles','')::integer,
    nullif(p_listing->>'part_miles_unit','')
  ) on conflict(id) do nothing;
  -- The minimum goes to listing_private_terms through its setter, and only when
  -- this call created the listing; a retry is compared by the check below.
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    perform public.set_listing_offer_floor(v_id, nullif(p_listing->>'offer_floor_cents','')::integer);
  end if;

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
     or v_existing.show_offer_floor is distinct from coalesce((p_listing->>'show_offer_floor')::boolean,false)
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

-- update_listing_atomic (20261018100000): unchanged except that the minimum is written
-- through set_listing_offer_floor instead of the listings column.
CREATE OR REPLACE FUNCTION public.update_listing_atomic(p_listing uuid, p_expected_updated_at timestamp with time zone, p_fields jsonb, p_images jsonb, p_fitments jsonb, p_alt_numbers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_row public.listings%rowtype;
  v_removed text[];
  v_updated_at timestamptz;
  v_floor integer;
begin
  if v_actor is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if jsonb_typeof(p_fields) is distinct from 'object'
     or (p_images is not null and jsonb_typeof(p_images) is distinct from 'array')
     or jsonb_typeof(p_fitments) is distinct from 'array'
     or jsonb_typeof(p_alt_numbers) is distinct from 'array'
     or (p_images is not null and jsonb_array_length(p_images) > 12)
     or jsonb_array_length(p_fitments) > 10
     or jsonb_array_length(p_alt_numbers) > 5
     or p_expected_updated_at is null then
    raise exception 'Invalid listing edit' using errcode = '22023';
  end if;

  select * into v_row from public.listings where id = p_listing for update;
  if not found or v_row.seller_id is distinct from v_actor then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;
  if public.is_suspended(v_actor) then
    raise exception 'account is suspended' using errcode = '42501';
  end if;
  if v_row.status in ('sold', 'reserved', 'removed') then
    raise exception 'A sold, reserved or removed listing can''t be edited' using errcode = '55000';
  end if;
  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'Listing changed after this edit began; reload before saving'
      using errcode = '40001';
  end if;
  if v_row.status = 'active' and p_images is not null and jsonb_array_length(p_images) = 0 then
    raise exception 'A live listing needs at least one photo' using errcode = '23514';
  end if;

  -- The minimum lives in listing_private_terms. It is written on whichever side
  -- of a price change keeps it at or below the price at every step.
  v_floor := nullif(p_fields->>'offer_floor_cents', '')::integer;
  if v_floor is not null and (v_floor <= 0 or v_floor > (p_fields->>'price_cents')::integer) then
    raise exception 'The offer minimum must be above zero and no more than the asking price'
      using errcode = '23514';
  end if;
  if v_floor is null or v_floor <= v_row.price_cents then
    perform public.set_listing_offer_floor(p_listing, v_floor);
  end if;

  update public.listings set
    source_car_id = nullif(p_fields->>'source_car_id', '')::uuid,
    title = p_fields->>'title',
    description = nullif(p_fields->>'description', ''),
    category = p_fields->>'category',
    subcategory = nullif(p_fields->>'subcategory', ''),
    condition = nullif(p_fields->>'condition', ''),
    grade = nullif(p_fields->>'grade', ''),
    condition_checklist = nullif(p_fields->'condition_checklist', 'null'::jsonb),
    price_cents = (p_fields->>'price_cents')::integer,
    shipping_cents = (p_fields->>'shipping_cents')::integer,
    shipping_mode = p_fields->>'shipping_mode',
    weight_oz = nullif(p_fields->>'weight_oz', '')::numeric,
    length_in = nullif(p_fields->>'length_in', '')::numeric,
    width_in = nullif(p_fields->>'width_in', '')::numeric,
    height_in = nullif(p_fields->>'height_in', '')::numeric,
    show_offer_floor = coalesce((p_fields->>'show_offer_floor')::boolean, false),
    allows_collection = (p_fields->>'allows_collection')::boolean,
    location = nullif(p_fields->>'location', ''),
    compatibility_notes = nullif(p_fields->>'compatibility_notes', ''),
    part_number = nullif(p_fields->>'part_number', ''),
    brand = nullif(btrim(p_fields->>'brand'), ''),
    part_miles = nullif(p_fields->>'part_miles', '')::integer,
    part_miles_unit = nullif(p_fields->>'part_miles_unit', '')
  where id = p_listing
  returning updated_at into v_updated_at;
  -- RLS can turn an update into zero rows without an error; zero rows is
  -- not a save.
  if not found then
    raise exception 'Listing not found' using errcode = 'P0002';
  end if;
  if v_floor > v_row.price_cents then
    perform public.set_listing_offer_floor(p_listing, v_floor);
  end if;

  if p_images is not null then
    select coalesce(array_agg(li.url), '{}') into v_removed
    from public.listing_images li
    where li.listing_id = p_listing
      and li.url not in (select item->>'url' from jsonb_array_elements(p_images) as image(item));

    delete from public.listing_images where listing_id = p_listing;
    insert into public.listing_images(listing_id, url, alt, position)
    select p_listing, item->>'url', nullif(item->>'alt', ''), ordinality - 1
    from jsonb_array_elements(p_images) with ordinality as image(item, ordinality);
  end if;

  delete from public.listing_fitments where listing_id = p_listing;
  insert into public.listing_fitments(listing_id, make, model, year_start, year_end)
  select p_listing, item->>'make', item->>'model', nullif(item->>'year_start', '')::integer,
         nullif(item->>'year_end', '')::integer
  from jsonb_array_elements(p_fitments) as fitment(item);

  delete from public.listing_part_numbers where listing_id = p_listing;
  insert into public.listing_part_numbers(listing_id, number)
  select p_listing, value from jsonb_array_elements_text(p_alt_numbers) as number(value);

  return jsonb_build_object(
    'listing_id', p_listing,
    'updated_at', v_updated_at,
    'removed_image_urls', to_jsonb(coalesce(v_removed, '{}'))
  );
end;
$function$;

-- guard_private_floor_within_price (20261017130000): unchanged except that it no
-- longer skips a row on the drvn.floor_checked_listing setting.
CREATE OR REPLACE FUNCTION public.guard_private_floor_within_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_price integer;
begin
  if new.offer_floor_cents is null then
    return new;
  end if;
  select l.price_cents into v_price from public.listings l where l.id = new.listing_id;
  if found and new.offer_floor_cents > v_price then
    raise exception 'The offer minimum must be no more than the asking price'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists listings_zz1_absorb_offer_floor on public.listings;
drop function if exists public.absorb_listing_offer_floor();

alter table public.listings drop constraint if exists listings_offer_floor_private;
alter table public.listings drop constraint if exists listings_offer_floor_bounds;
alter table public.listings drop column if exists offer_floor_cents;

alter table public.listing_private_terms
  alter constraint listing_private_terms_listing_id_fkey not deferrable;

comment on table public.listing_private_terms is
  'Listing terms only the seller (and the offer checks) may read; the only home of the offer minimum since 20261019120000. Written through set_listing_offer_floor.';
comment on column public.listing_private_terms.offer_floor_cents is
  'The lowest offer the seller will accept. Never shown to buyers unless the seller turns on listings.show_offer_floor. At or below the listing price.';

commit;
