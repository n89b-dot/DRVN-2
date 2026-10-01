-- 20261001120000 — editing a listing commits whole or not at all (RR-05).
--
-- Creation has been one transaction since 20260905233517. Editing was still
-- five separate writes from the server action: the listing row, then a
-- delete-and-reinsert of its photos (with a best-effort restore if the
-- insert failed), then fitment, then alternate part numbers. Any failure
-- after the first left a half-saved listing — new price, old photos, no
-- fitment — and "Listing updated, but…" told the seller so after the fact.
-- Nothing checked that the row was still the one the seller opened, so two
-- tabs overwrote each other and a checkout could reserve the part between
-- the action's read and its write.
--
-- update_listing_atomic does all of it in one transaction:
--   * the caller must own the listing and not be suspended;
--   * the row is locked and its updated_at must equal the one the form was
--     opened with (40001 otherwise — the second of two tabs gets a conflict,
--     not a silent overwrite);
--   * sold, reserved and removed listings refuse edits;
--   * a live listing can't be saved down to no photos;
--   * p_images null leaves the gallery untouched; an array replaces it.
-- It returns the new updated_at (the form's next expected version) and the
-- photo URLs this edit dropped, so the server action can garbage-collect
-- their storage objects only after the commit.
--
-- SECURITY INVOKER: the seller's own RLS and every listings trigger
-- (source-car ownership, status rules, beta commerce, reserved-price freeze)
-- apply exactly as they did to the separate writes. Column list matches
-- save_listing_creation's (20260919190500) minus id, seller_id and status,
-- which an edit never sets.
-- Idempotent.

begin;

create or replace function public.update_listing_atomic(
  p_listing uuid,
  p_expected_updated_at timestamptz,
  p_fields jsonb,
  p_images jsonb,
  p_fitments jsonb,
  p_alt_numbers jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
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

revoke all on function public.update_listing_atomic(uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.update_listing_atomic(uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) to authenticated;

commit;
