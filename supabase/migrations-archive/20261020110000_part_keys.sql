-- B1 — part keys on build lines, and the brand kept through a purchase
-- (plan 2026-10 agent and graph, Corrections and better ways §1 and §4).
--
-- A part is identified by who makes it and the number they give it. Listings
-- already carry a separator-free part number (0033, part_number_compact)
-- and a brand; build lines carried both as free text only, so a mod and a
-- listing of the same part couldn't be joined, and "a part from your build
-- is for sale" or a price comparable had nothing to key on.
--
--   mod_items.part_number_compact — the same expression as listings'
--     (0033): lower-cased, everything but a-z0-9 removed, '' → null.
--   mod_items.brand_key — the brand lower-cased with everything but letters
--     and digits removed, '' → null. Compacting (not just lower-casing)
--     matters for build lines: the paste parser leaves "-Bosch", members type
--     "H&R" and "H and R" is not a brand. Letters outside ASCII ("Öhlins")
--     are kept. The products identity (20261020120000) uses this same
--     expression for listings' brands; listings.brand_key stays lower(brand)
--     because the marketplace brand filter compares it.
--
-- Both are generated, so every writer (save_mod_items, the purchase action,
-- the link importer) gets them for free and none can set them wrongly.
--
-- The purchase snapshot gains the listing's brand (part.brand), so a part
-- added to a car from an order keeps it (addPurchaseToCar used to drop it:
-- the snapshot never had it). Snapshots taken before this have no brand and
-- stay as they are — they're immutable, and the brand at purchase time is
-- not known for them.
--
-- Idempotent.

begin;

alter table public.mod_items
  add column if not exists part_number_compact text
    generated always as (nullif(regexp_replace(lower(coalesce(part_number, '')), '[^a-z0-9]', '', 'g'), '')) stored,
  add column if not exists brand_key text
    generated always as (nullif(regexp_replace(lower(coalesce(brand, '')), '[^[:alnum:]]', '', 'g'), '')) stored;

comment on column public.mod_items.part_number_compact is
  'part_number lower-cased with every non a-z0-9 character removed (the listings.part_number_compact expression). Generated.';
comment on column public.mod_items.brand_key is
  'brand lower-cased with everything but letters and digits removed ("-Bosch", "BOSCH" -> bosch). Generated; the products identity half.';

-- Build lines of one part, by number then brand: "is this part on a build",
-- "who has fitted this", and the products backfill.
create index if not exists mod_items_part_key_idx
  on public.mod_items (part_number_compact, brand_key)
  where part_number_compact is not null;

-- Restated from 0056 with one line added: 'brand' in the part block.
create or replace function public.listing_commercial_snapshot(p_listing_id uuid, p_price_cents integer, p_shipping_cents integer)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_listing record;
  v_fitment jsonb;
  v_alt_numbers jsonb;
  v_car jsonb;
  v_seller jsonb;
  v_shop record;
  v_return_policy jsonb;
begin
  select l.id, l.seller_id, l.source_car_id, l.title, l.description,
         l.category, l.subcategory, l.condition, l.grade,
         l.condition_checklist, l.compatibility_notes, l.part_number,
         l.price_cents, l.currency, l.shipping_cents, l.allows_collection,
         l.shipping_mode, l.brand
    into v_listing
    from public.listings l
   where l.id = p_listing_id;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'make', f.make, 'model', f.model,
             'year_start', f.year_start, 'year_end', f.year_end
           ) order by f.make, f.model, f.year_start
         ), '[]'::jsonb)
    into v_fitment
    from public.listing_fitments f
   where f.listing_id = p_listing_id;

  select coalesce(jsonb_agg(pn.number order by pn.created_at), '[]'::jsonb)
    into v_alt_numbers
    from public.listing_part_numbers pn
   where pn.listing_id = p_listing_id;

  select jsonb_strip_nulls(jsonb_build_object(
           'id', c.id, 'name', c.name,
           'year', c.year, 'make', c.make, 'model', c.model
         ))
    into v_car
    from public.cars c
   where c.id = v_listing.source_car_id;

  select jsonb_strip_nulls(jsonb_build_object(
           'id', p.id,
           'username', p.username,
           'display_name', p.display_name,
           'profile_type', p.profile_type
         ))
    into v_seller
    from public.profiles p
   where p.id = v_listing.seller_id;

  -- Shop context (0056): the seller's verification state and — when they
  -- accept preference returns — the policy the buyer purchased under.
  select sp.verification_status, sp.returns_accepted, sp.return_window_days
    into v_shop
    from public.shop_profiles sp
   where sp.profile_id = v_listing.seller_id;

  if found then
    v_seller := v_seller || jsonb_build_object(
      'verified_shop', v_shop.verification_status = 'verified'
    );
    if v_shop.returns_accepted then
      v_return_policy := jsonb_build_object(
        'returns_accepted', true,
        'window_days', v_shop.return_window_days
      );
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'version', 1,
    'captured_at', now(),
    'listing', jsonb_build_object(
      'id', v_listing.id,
      'title', v_listing.title,
      'description', v_listing.description,
      'category', v_listing.category,
      'subcategory', v_listing.subcategory
    ),
    'part', jsonb_build_object(
      'part_number', v_listing.part_number,
      'brand', v_listing.brand,
      'alt_part_numbers', v_alt_numbers
    ),
    'condition', jsonb_build_object(
      'condition', v_listing.condition,
      'grade', v_listing.grade,
      'checklist', v_listing.condition_checklist,
      'compatibility_notes', v_listing.compatibility_notes
    ),
    'fitment', v_fitment,
    'source_car', v_car,
    'commercial', jsonb_build_object(
      'price_cents', p_price_cents,
      'listing_price_cents', v_listing.price_cents,
      'currency', v_listing.currency,
      'shipping_cents', p_shipping_cents,
      'shipping_mode', case v_listing.shipping_mode
                         when 'drvn' then 'drvn_shipping'
                         when 'pickup_only' then 'pickup_only'
                         else 'seller_arranged'
                       end,
      'allows_collection', v_listing.allows_collection,
      'return_policy', v_return_policy
    ),
    'seller', v_seller
  ));
end;
$function$;
revoke all on function public.listing_commercial_snapshot(uuid, int, int) from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mod_items' and column_name = 'brand_key'
  ) then
    raise exception '20261020110000: mod_items.brand_key missing';
  end if;
  raise notice 'PASS: 20261020110000 self-checks';
end $$;

commit;
