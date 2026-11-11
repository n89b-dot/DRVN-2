-- Catalog snapshot generated from src/lib/marketplace/taxonomy.ts.
-- The taxonomy test checks this snapshot so schema and seller choices cannot drift.
-- catalog-snapshot: [{"slug":"performance","subcategories":["exhaust","intake","turbo","intercoolers","tuning","fueling"]},{"slug":"engine","subcategories":["internals","drivetrain","transmission","engine-mounts","maintenance"]},{"slug":"exterior-body","subcategories":["aero","bumpers","hoods","spoilers","mirrors-trim"]},{"slug":"interior-lighting","subcategories":["seats","steering","gauges","headlights","interior-trim"]},{"slug":"brakes-suspension","subcategories":["big-brake-kits","pads-rotors","coilovers","sway-bars","air-ride"]},{"slug":"wheels-tires","subcategories":["wheels","tires","spacers-hardware","tpms"]}]
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- Supported one-to-one parent mappings only. Part types remain unknown.
-- Guards only touch still-legacy assignments; repeat runs do not overwrite edits.
update public.listings set category='interior-lighting' where category='interior';
update public.listings set category='brakes-suspension' where category='brakes';
-- Keep existing alerts scoped to the same inventory after a parent rename.
update public.saved_searches set params=jsonb_set(params,'{category}','"interior-lighting"'::jsonb) where params->>'category'='interior';
update public.saved_searches set params=jsonb_set(params,'{category}','"brakes-suspension"'::jsonb) where params->>'category'='brakes';
alter table public.listings drop constraint if exists listings_catalog_assignment;
alter table public.listings add constraint listings_catalog_assignment check (
  category in ('performance', 'engine', 'exterior-body', 'interior-lighting', 'brakes-suspension', 'wheels-tires')
  and (subcategory is null or (category = 'performance' and subcategory in ('exhaust', 'intake', 'turbo', 'intercoolers', 'tuning', 'fueling'))
      or (category = 'engine' and subcategory in ('internals', 'drivetrain', 'transmission', 'engine-mounts', 'maintenance'))
      or (category = 'exterior-body' and subcategory in ('aero', 'bumpers', 'hoods', 'spoilers', 'mirrors-trim'))
      or (category = 'interior-lighting' and subcategory in ('seats', 'steering', 'gauges', 'headlights', 'interior-trim'))
      or (category = 'brakes-suspension' and subcategory in ('big-brake-kits', 'pads-rotors', 'coilovers', 'sway-bars', 'air-ride'))
      or (category = 'wheels-tires' and subcategory in ('wheels', 'tires', 'spacers-hardware', 'tpms')))
) not valid;
alter table public.listings validate constraint listings_catalog_assignment;
notify pgrst, 'reload schema';
commit;
