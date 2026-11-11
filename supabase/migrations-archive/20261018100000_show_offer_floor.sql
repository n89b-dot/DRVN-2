-- 20261018100000 — a seller may show their offer minimum on the listing
-- (PRD O-3; negotiation v2, A1).
--
-- The minimum is private (20261017120000 / 20261017130000), and showing it is
-- the seller's choice, off by default. The choice is a public flag on the
-- listing, `listings.show_offer_floor`; the amount stays in
-- listing_private_terms. listing_public_offer_floor(listing) returns it only
-- when the seller turned the flag on and the listing is visible, so there is
-- no second copy of the minimum to keep in step.
--
-- save_listing_creation and update_listing_atomic save the flag with the
-- rest of the form: three places in the first (insert list, values, replay
-- check) and one in the second, bodies otherwise unchanged. A form that
-- doesn't send it (an older app build) saves it as off.
-- Idempotent.

begin;

alter table public.listings add column if not exists show_offer_floor boolean not null default false;
comment on column public.listings.show_offer_floor is
  'The seller chose to show their offer minimum on the listing (O-3). The amount itself is in listing_private_terms.';

create or replace function public.listing_public_offer_floor(p_listing uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select t.offer_floor_cents
  from public.listings l
  join public.listing_private_terms t on t.listing_id = l.id
  where l.id = p_listing
    and l.show_offer_floor
    and l.status in ('active', 'reserved', 'sold')
    and (l.seller_id = (select auth.uid()) or not (l.seller_id in (select public.suspended_profile_ids())));
$function$;

comment on function public.listing_public_offer_floor(uuid) is
  'A listing''s offer minimum, only when its seller chose to show it (O-3); null otherwise.';

revoke all on function public.listing_public_offer_floor(uuid) from public;
grant execute on function public.listing_public_offer_floor(uuid) to anon, authenticated, service_role;

-- save_listing_creation (20261017130000) and update_listing_atomic
-- (20261001120000): unchanged except that they save show_offer_floor.
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
    weight_oz,length_in,width_in,height_in,offer_floor_cents,show_offer_floor,allows_collection,
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
    coalesce((p_listing->>'show_offer_floor')::boolean,false),
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
    offer_floor_cents = nullif(p_fields->>'offer_floor_cents', '')::integer,
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

commit;
