-- OS-W23 follow-up (GPT review of #105): the build sheet's lock and revision
-- hold for every write, not only for save_mod_items.
--
--   1  Unlinking a listing was three requests: read the revision, unlink with
--      a direct table update, read the revision again. A line another tab
--      added in between was folded into the "after" revision the editor then
--      adopted without ever loading the line, so its next save deleted it.
--      unlink_mod_listing checks the revision the editor holds, unlinks and
--      returns the resulting revision under one lock.
--   2  An owner's direct mod_items write (unlink, "mark as off the car",
--      "add to my car", a listing release, the API) took no lock, so it could
--      commit after save_mod_items checked the revision and before its upsert,
--      and the upsert overwrote it. Every write to mod_items now takes the
--      car's lock first and moves updated_at strictly on (so the revision
--      changes on every write), so it either lands before the
--      save reads the revision (and the save is refused as stale) or waits
--      until the save commits (and moves the revision on for everyone).
--      Revoking member writes instead would break save_listing_creation and
--      save_mod_items (both run with the member's rights) and three server
--      actions, so the lock is held where every path meets: the table.
--   3  mod_sheet_matches ignored confidence, source_domain and
--      ref_price_currency, so after a lost response another tab's
--      currency-only change passed for the original save. It now compares
--      every column the payload writes, normalised exactly as
--      save_mod_items normalises it.
--   4  The gallery (48) and showcase (8) caps ran only on INSERT; an owner
--      with two cars could move a photo or pin into a full car by updating
--      car_id. A member's write can no longer move either between cars (the
--      app never does); trusted server paths keep the exemption the caps
--      have. #73's member_media_ref_guard still checks the URL on any move.
--
-- Owns from here: public.mod_sheet_matches(uuid, jsonb) (was 20261107220100).
-- New: public.unlink_mod_listing, private.mod_sheet_lock,
-- private.car_media_stays_on_car and their triggers.

begin;

-- ------------------------------------------------------------
-- 2: every write to a build line takes the sheet's lock
-- ------------------------------------------------------------
-- The sheet's lock is its car's row (save_mod_items, replace_car_showcase
-- and edit_car_gallery all take it). Definer so the lock never depends on the
-- writer's own grants: a cascade, a definer function or a member's token all
-- queue the same way. NO KEY UPDATE conflicts with the FOR UPDATE those
-- functions take and with itself, but not with the key-share locks other
-- tables' foreign keys take on a car, so it adds no contention beyond the
-- sheet.
--
-- mod_sheet_revision hashes each line's full contents, updated_at included,
-- so every update must move updated_at, strictly: on from the clock and
-- never back to an earlier or equal value, even for two writes in one
-- transaction or two in the same microsecond. Otherwise a write that puts a
-- value back unchanged would leave the revision unmoved. This trigger is now
-- the only thing that sets mod_items.updated_at. 0007's
-- mod_items_touch_updated_at ran after it and reset the value to now() (the
-- transaction's start), so it is dropped below; touch_updated_at still
-- serves the other tables.
create or replace function private.mod_sheet_lock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform 1 from public.cars c where c.id = old.car_id for no key update;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.car_id is distinct from old.car_id then
    -- A line moved between two sheets: both, in a fixed order.
    perform 1 from public.cars c where c.id in (old.car_id, new.car_id) order by c.id for no key update;
  else
    perform 1 from public.cars c where c.id = new.car_id for no key update;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  return new;
end;
$$;

revoke all on function private.mod_sheet_lock() from public, anon, authenticated;

-- Named to fire before every other row trigger on the table (they fire in
-- name order), so the guards after it read the sheet under the lock.
drop trigger if exists mod_items_touch_updated_at on public.mod_items;
drop trigger if exists aa_mod_sheet_lock on public.mod_items;
create trigger aa_mod_sheet_lock
  before insert or update or delete on public.mod_items
  for each row execute function private.mod_sheet_lock();

-- ------------------------------------------------------------
-- 3: a lost save is recognised only when every saved field matches
-- ------------------------------------------------------------
-- Every column save_mod_items writes from the payload, normalised the same
-- way: nothing another tab can change passes for the save that was lost.
create or replace function public.mod_sheet_matches(p_car uuid, p_items jsonb)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select
    (select count(*)
       from jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
       join public.mod_items m on m.id = (item.value->>'id')::uuid and m.car_id = p_car
      where m.position = item.ordinality::integer - 1
        and m.group_label = coalesce(nullif(btrim(item.value->>'group_label'), ''), 'Other')
        and m.category is not distinct from nullif(item.value->>'category', '')
        and m.brand is not distinct from nullif(btrim(item.value->>'brand'), '')
        and m.product is not distinct from nullif(btrim(item.value->>'product'), '')
        and m.part_number is not distinct from nullif(btrim(item.value->>'part_number'), '')
        and m.raw_text is not distinct from nullif(btrim(item.value->>'raw_text'), '')
        and m.confidence is not distinct from (
              case when nullif(item.value->>'confidence', '') is null
                then null else (item.value->>'confidence')::real end)
        and m.status = coalesce(nullif(item.value->>'status', ''), 'installed')
        and m.product_url is not distinct from nullif(btrim(item.value->>'product_url'), '')
        and m.image_url is not distinct from nullif(btrim(item.value->>'image_url'), '')
        and m.source_domain is not distinct from nullif(btrim(item.value->>'source_domain'), '')
        and m.ref_price_cents is not distinct from (
              case when nullif(item.value->>'ref_price_cents', '') is null
                then null else (item.value->>'ref_price_cents')::integer end)
        and m.ref_price_currency is not distinct from nullif(btrim(item.value->>'ref_price_currency'), '')
        and m.origin = coalesce(nullif(item.value->>'origin', ''), m.origin)
    ) = jsonb_array_length(p_items)
    and not exists (
      select 1 from public.mod_items m
       where m.car_id = p_car
         and m.linked_listing_id is null
         and m.source_order_item_id is null
         and not exists (select 1 from jsonb_array_elements(p_items) item where (item->>'id')::uuid = m.id)
    );
$$;

revoke all on function public.mod_sheet_matches(uuid, jsonb) from public, anon;
grant execute on function public.mod_sheet_matches(uuid, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------
-- 1: unlinking a listing is one locked, revision-checked write
-- ------------------------------------------------------------
-- Invoker, like save_mod_items: the member's own row security decides which
-- line they can touch. Refuses (40001, hint stale_mod_sheet) unless the sheet
-- is still the revision the editor loaded, and hands back the revision the
-- unlink produced, so the editor moves on only past its own write.
create or replace function public.unlink_mod_listing(p_car uuid, p_mod_item uuid, p_expected_revision text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_listing uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to edit this build.' using errcode = '42501';
  end if;
  if p_car is null or p_mod_item is null then
    raise exception 'Missing build line.' using errcode = '22023';
  end if;
  if p_expected_revision is null then
    raise exception 'Reload the build before saving.' using errcode = '22023';
  end if;

  perform 1 from public.cars c where c.id = p_car and c.owner_id = auth.uid() for update;
  if not found then
    raise exception 'Car not found.' using errcode = '42501';
  end if;
  if public.mod_sheet_revision(p_car) is distinct from p_expected_revision then
    raise exception 'This build changed since you opened it — in another tab or from your agent. Reload to see the latest.'
      using errcode = '40001', hint = 'stale_mod_sheet';
  end if;

  select m.linked_listing_id into v_listing
    from public.mod_items m
   where m.id = p_mod_item and m.car_id = p_car;
  if not found then
    raise exception 'That line isn''t on this build.' using errcode = 'P0002';
  end if;
  if v_listing is not null then
    update public.mod_items m set linked_listing_id = null
     where m.id = p_mod_item and m.car_id = p_car;
  end if;

  return jsonb_build_object(
    'revision', public.mod_sheet_revision(p_car),
    'listing_id', v_listing
  );
end;
$$;

revoke all on function public.unlink_mod_listing(uuid, uuid, text) from public, anon;
grant execute on function public.unlink_mod_listing(uuid, uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------
-- 4: a member can't move a photo or pin into another car
-- ------------------------------------------------------------
-- The caps (car_images_0_cap, car_hotspots_0_cap) count a car's rows on
-- insert; moving a row in by changing car_id skipped them, and a moved pin
-- would also keep pointing at the old car's photo and part. Nothing in the
-- app moves either, so a member's write may not; trusted server paths (no
-- member token) keep the exemption the caps give them.
create or replace function private.car_media_stays_on_car()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is not null and new.car_id is distinct from old.car_id then
    raise exception 'A photo or pin stays on the car it was added to.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.car_media_stays_on_car() from public, anon, authenticated;

drop trigger if exists car_images_0_stays on public.car_images;
create trigger car_images_0_stays
  before update of car_id on public.car_images
  for each row execute function private.car_media_stays_on_car();

drop trigger if exists car_hotspots_0_stays on public.car_hotspots;
create trigger car_hotspots_0_stays
  before update of car_id on public.car_hotspots
  for each row execute function private.car_media_stays_on_car();

notify pgrst, 'reload schema';
commit;
