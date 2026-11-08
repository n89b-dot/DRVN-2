-- OS-W23: garage integrity, held in the database.
--
--   N65   A stale Garage tab (or an agent draft read before a newer edit)
--         replaced the whole build sheet with what it had loaded, deleting
--         lines added since and overwriting newer values (Codex S1).
--         save_mod_items now takes the sheet revision the editor loaded and
--         refuses a stale save (40001, hint stale_mod_sheet). A retry of a
--         save that already committed still converges.
--   N66   The showcase was replaced in two requests: pins deleted, then new
--         ones inserted, so a failed insert lost the old showcase (Codex S2).
--         replace_car_showcase validates everything and swaps the pins in
--         one transaction.
--   N248  "Gallery edits are locked and capped" held only for
--         edit_car_gallery; an owner's token could insert car_images and
--         car_hotspots directly, past the caps and without the car lock.
--         Insert triggers now take the car lock and enforce both caps for
--         every write made with a member's token.
--
-- save_mod_items(uuid, jsonb) is replaced by save_mod_items(uuid, jsonb,
-- text); this migration is that function's owner from here on. Every other
-- function here is new. All are SECURITY INVOKER except the two trigger
-- functions, which only lock and count.

begin;

-- ------------------------------------------------------------
-- N65: the build sheet's revision
-- ------------------------------------------------------------
-- A hash of every line's full contents (updated_at included), so any write
-- to the sheet, from any screen, and adding or deleting a line, changes it.
-- Invoker: a caller hashes only the lines they can read, and only the owner
-- can save.
create or replace function public.mod_sheet_revision(p_car uuid)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select md5(coalesce(string_agg(md5(m::text), ',' order by m.id), ''))
    from public.mod_items m
   where m.car_id = p_car;
$$;

revoke all on function public.mod_sheet_revision(uuid) from public, anon;
grant execute on function public.mod_sheet_revision(uuid) to authenticated, service_role;

-- True when the car's sheet already is exactly what the payload asks for:
-- the same lines in the same order with the same values, and nothing the
-- payload would delete. Lets a lost-response retry succeed without writing.
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
        and m.status = coalesce(nullif(item.value->>'status', ''), 'installed')
        and m.product_url is not distinct from nullif(btrim(item.value->>'product_url'), '')
        and m.image_url is not distinct from nullif(btrim(item.value->>'image_url'), '')
        and m.ref_price_cents is not distinct from (nullif(item.value->>'ref_price_cents', ''))::integer
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

drop function if exists public.save_mod_items(uuid, jsonb);

create function public.save_mod_items(p_car_id uuid, p_items jsonb, p_expected_revision text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_expected integer;
  v_written integer;
  v_current text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to save this build.' using errcode = '42501';
  end if;
  if p_car_id is null then
    raise exception 'Missing car.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Modification lines must be an array.' using errcode = '22023';
  end if;

  v_expected := jsonb_array_length(v_items);
  if v_expected > 200 then
    raise exception 'A build can contain at most 200 modification lines.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.cars c where c.id = p_car_id and c.owner_id = auth.uid()
  ) then
    raise exception 'Car not found.' using errcode = '42501';
  end if;
  if p_expected_revision is null then
    raise exception 'Reload the build before saving.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_items) item
    where coalesce(item->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'Every modification line needs a stable id.' using errcode = '22023';
  end if;
  if exists (
    select item->>'id'
    from jsonb_array_elements(v_items) item
    group by item->>'id'
    having count(*) > 1
  ) then
    raise exception 'Modification line ids must be unique.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_items) item
    join public.mod_items existing on existing.id = (item->>'id')::uuid
    where existing.car_id <> p_car_id
  ) then
    raise exception 'A modification line belongs to another car.' using errcode = '42501';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_items) item
    where nullif(item->>'category', '') is not null
      and item->>'category' not in (
        'suspension', 'exhaust', 'intake', 'turbo', 'wheels', 'brakes',
        'ecu-tune', 'aero-exterior', 'interior', 'drivetrain'
      )
  ) then
    raise exception 'Unsupported modification category.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_items) item
    where nullif(item->>'confidence', '') is not null
      and ((item->>'confidence')::real < 0 or (item->>'confidence')::real > 1)
  ) then
    raise exception 'Modification confidence must be between zero and one.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_items) item
    where coalesce(nullif(item->>'status', ''), 'installed') not in ('installed', 'removed')
  ) then
    raise exception 'A modification line is neither installed nor removed.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_items) item
    where nullif(item->>'origin', '') is not null
      and item->>'origin' not in ('aftermarket', 'stock')
  ) then
    raise exception 'A modification line is neither aftermarket nor stock.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_items) item
    where nullif(item->>'ref_price_cents', '') is not null
      and (
        nullif(btrim(item->>'ref_price_currency'), '') is null
        or (item->>'ref_price_cents')::integer < 0
      )
  ) then
    raise exception 'A reference price needs a currency.' using errcode = '22023';
  end if;

  -- N65 (OS-W21 follow-on, OS-W23): the sheet is saved only over the version
  -- the editor loaded. Saves of one car queue on its row; then the current
  -- revision must be the one the caller read, or nothing is written — an
  -- older tab, or a draft the agent read before a newer edit, can no longer
  -- delete or overwrite lines it never saw.
  perform 1 from public.cars c where c.id = p_car_id for update;
  v_current := public.mod_sheet_revision(p_car_id);
  if v_current is distinct from p_expected_revision then
    -- A retry of a save that already committed (its response was lost)
    -- finds the sheet exactly as it asked: report it saved, write nothing.
    if public.mod_sheet_matches(p_car_id, v_items) then
      return jsonb_build_object(
        'outcome', 'saved',
        'revision', v_current,
        'items', coalesce((
          select jsonb_agg(
                   jsonb_build_object('id', item.id, 'position', item.position, 'status', item.status)
                   order by item.position
                 )
          from public.mod_items item
          where item.car_id = p_car_id
        ), '[]'::jsonb)
      );
    end if;
    raise exception 'This build changed since you opened it — in another tab or from your agent. Reload to see the latest.'
      using errcode = '40001', hint = 'stale_mod_sheet';
  end if;

  -- A row the payload omits is a row the editor deleted — unless the editor
  -- never knew it. A line released for sale (A-1: delete only where it can't
  -- orphan a listing) and a line that came from a purchase (C-1) are both
  -- written from OTHER screens, so a sheet left open in a second tab would
  -- omit them and this statement would erase them. Neither is deletable from
  -- the sheet: they come off the car by being marked removed.
  delete from public.mod_items existing
  where existing.car_id = p_car_id
    and existing.linked_listing_id is null
    and existing.source_order_item_id is null
    and not exists (
      select 1
      from jsonb_array_elements(v_items) item
      where (item->>'id')::uuid = existing.id
    );

  insert into public.mod_items (
    id, car_id, group_label, category, brand, product, part_number,
    raw_text, confidence, position, status, removed_at,
    product_url, image_url, source_domain, ref_price_cents, ref_price_currency,
    origin, updated_at
  )
  select
    (item.value->>'id')::uuid,
    p_car_id,
    coalesce(nullif(btrim(item.value->>'group_label'), ''), 'Other'),
    nullif(item.value->>'category', ''),
    nullif(btrim(item.value->>'brand'), ''),
    nullif(btrim(item.value->>'product'), ''),
    nullif(btrim(item.value->>'part_number'), ''),
    nullif(btrim(item.value->>'raw_text'), ''),
    case when nullif(item.value->>'confidence', '') is null
      then null else (item.value->>'confidence')::real end,
    item.ordinality::integer - 1,
    coalesce(nullif(item.value->>'status', ''), 'installed'),
    case when coalesce(nullif(item.value->>'status', ''), 'installed') = 'removed'
      then now() else null end,
    nullif(btrim(item.value->>'product_url'), ''),
    nullif(btrim(item.value->>'image_url'), ''),
    nullif(btrim(item.value->>'source_domain'), ''),
    case when nullif(item.value->>'ref_price_cents', '') is null
      then null else (item.value->>'ref_price_cents')::integer end,
    nullif(btrim(item.value->>'ref_price_currency'), ''),
    coalesce(nullif(item.value->>'origin', ''), 'aftermarket'),
    now()
  from jsonb_array_elements(v_items) with ordinality as item(value, ordinality)
  on conflict (id) do update set
    group_label = excluded.group_label,
    category = excluded.category,
    brand = excluded.brand,
    product = excluded.product,
    part_number = excluded.part_number,
    raw_text = excluded.raw_text,
    confidence = excluded.confidence,
    position = excluded.position,
    status = excluded.status,
    -- Derived, never client-supplied: a line that was already off the car
    -- keeps the date it came off; re-fitting one clears it.
    removed_at = case
      when excluded.status = 'removed'
        then coalesce(public.mod_items.removed_at, now())
      else null
    end,
    product_url = excluded.product_url,
    image_url = excluded.image_url,
    source_domain = excluded.source_domain,
    ref_price_cents = excluded.ref_price_cents,
    ref_price_currency = excluded.ref_price_currency,
    -- An editor that predates origin omits it; the line keeps what it was.
    origin = coalesce(
      (select nullif(sent->>'origin', '')
         from jsonb_array_elements(v_items) sent
        where (sent->>'id')::uuid = excluded.id),
      public.mod_items.origin
    ),
    updated_at = excluded.updated_at
  where public.mod_items.car_id = excluded.car_id;

  get diagnostics v_written = row_count;
  if v_written <> v_expected then
    raise exception 'The modification sheet changed while it was being saved.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'outcome', 'saved',
    'revision', public.mod_sheet_revision(p_car_id),
    'items', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', item.id, 'position', item.position, 'status', item.status)
               order by item.position
             )
      from public.mod_items item
      where item.car_id = p_car_id
    ), '[]'::jsonb)
  );
end;
$function$;



revoke all on function public.save_mod_items(uuid, jsonb, text) from public, anon;
grant execute on function public.save_mod_items(uuid, jsonb, text) to authenticated, service_role;

-- ------------------------------------------------------------
-- N66: the showcase is replaced in one transaction
-- ------------------------------------------------------------
create or replace function public.replace_car_showcase(p_car uuid, p_image_url text, p_pins jsonb)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_pins jsonb := coalesce(p_pins, '[]'::jsonb);
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to edit this build.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_pins) <> 'array' then
    raise exception 'Pins must be a list.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(v_pins);
  if v_count > 8 then
    raise exception 'A showcase has at most 8 pins.' using errcode = '22023';
  end if;
  -- The owner's car, locked so a second save queues behind this one.
  perform 1 from public.cars c where c.id = p_car and c.owner_id = auth.uid() for update;
  if not found then
    raise exception 'Car not found.' using errcode = '42501';
  end if;

  -- Validate everything before anything changes.
  if v_count > 0 then
    if not exists (select 1 from public.car_images i where i.car_id = p_car and i.url = p_image_url) then
      raise exception 'Pick one of this car''s photos for the showcase.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_pins) pin
       where jsonb_typeof(pin->'x') <> 'number' or jsonb_typeof(pin->'y') <> 'number'
          or (pin->>'x')::numeric not between 0 and 1 or (pin->>'y')::numeric not between 0 and 1
          or char_length(btrim(coalesce(pin->>'label', ''))) not between 1 and 80
    ) then
      raise exception 'Every pin needs a place on the photo and a label.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_pins) pin
       where nullif(pin->>'mod_item_id', '') is not null
         and not exists (
           select 1 from public.mod_items m
            where m.id = (pin->>'mod_item_id')::uuid and m.car_id = p_car
         )
    ) then
      raise exception 'A pin names a part that isn''t on this build.' using errcode = '22023';
    end if;
  end if;

  delete from public.car_hotspots where car_id = p_car;
  insert into public.car_hotspots (car_id, image_url, x, y, mod_item_id, label)
  select p_car, p_image_url,
         round((pin->>'x')::numeric, 3), round((pin->>'y')::numeric, 3),
         nullif(pin->>'mod_item_id', '')::uuid, btrim(pin->>'label')
    from jsonb_array_elements(v_pins) pin;
  return v_count;
end;
$$;

revoke all on function public.replace_car_showcase(uuid, text, jsonb) from public, anon;
grant execute on function public.replace_car_showcase(uuid, text, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------
-- N248: the gallery and showcase caps hold on every write path
-- ------------------------------------------------------------
-- Definer so the lock is taken whatever the member's own grants: an owner's
-- direct insert queues behind edit_car_gallery, and the count it then sees
-- is final. Only a member's own token is capped here (auth.uid() is set) —
-- the gallery function caps itself, and trusted server paths (seeds, the
-- service role, fixtures) are not members, as with the write quotas.
create or replace function private.car_media_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cap integer := tg_argv[0]::integer;
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  perform 1 from public.cars c where c.id = new.car_id for update;
  if tg_table_name = 'car_images'
     and (select count(*) from public.car_images i where i.car_id = new.car_id) >= v_cap then
    raise exception 'A gallery can hold up to % photos', v_cap using errcode = '23514';
  end if;
  if tg_table_name = 'car_hotspots'
     and (select count(*) from public.car_hotspots h where h.car_id = new.car_id) >= v_cap then
    raise exception 'showcase hotspot limit reached (%)', v_cap using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.car_media_cap() from public, anon, authenticated;

-- Named to fire before the other insert triggers (they fire in name order),
-- so car_hotspots_count_guard's count also runs under the lock.
drop trigger if exists car_images_0_cap on public.car_images;
create trigger car_images_0_cap
  before insert on public.car_images
  for each row execute function private.car_media_cap('48');

drop trigger if exists car_hotspots_0_cap on public.car_hotspots;
create trigger car_hotspots_0_cap
  before insert on public.car_hotspots
  for each row execute function private.car_media_cap('8');

commit;
