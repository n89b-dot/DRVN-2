-- 20260919170000 — Mod records keep their identity (PRD 2026-09 A-1…A-3,
-- L-1…L-4, C-1; build plan WS2 + WS6, with WS4's column).
--
-- Today a mod line only exists while it is on the car: the editor drops the
-- row from its array, `save_mod_items` deletes anything the payload omits,
-- and the part is gone — along with the fact that it was ever fitted, and
-- along with any listing that pointed at it. That makes the product's first
-- loop (change a part, sell the old one) impossible to tell truthfully: a
-- build page can't say "came off this car" about a row that no longer exists.
--
-- Removal becomes a STATE:
--
--   * status ('installed' | 'removed') + removed_at. Remove keeps the id and
--     marks the row; Replace (a new editor action) marks the old row removed
--     and inserts a new id in its position; editing in place stays what it is
--     — a fix for typos. A true delete remains "omit the row", which is why
--     the delete statement below is byte-identical to 20260905224929's.
--   * Every reader now has to choose. They are listed in the build plan; the
--     public build sheet and the garage show removed lines under "came off
--     this car", and search/OG/indexing ignore them.
--
-- The same sheet gains the columns two neighbouring workstreams need, because
-- `save_mod_items` should be re-created once rather than three times:
--
--   * product_url / image_url / source_domain / ref_price_cents +
--     ref_price_currency — "add a mod by pasting a link" (L-1…L-4). The price
--     carries its currency or it is not a price, enforced here rather than
--     hoped for in the reader.
--   * source_order_item_id — "add what I bought to my car" (C-1), unique so a
--     second tap adds nothing. It is written by the server action from the
--     order item's frozen purchase record, never through the sheet, so it is
--     deliberately absent from the function's column lists: leaving it out is
--     what makes an ordinary sheet save preserve it.
--
-- Idempotent. Safe to re-run.

begin;

-- ============================================================
-- 1. Columns
-- ============================================================
alter table public.mod_items
  add column if not exists status text not null default 'installed',
  add column if not exists removed_at timestamptz,
  add column if not exists source_order_item_id uuid
    references public.order_items (id) on delete set null,
  add column if not exists product_url text,
  add column if not exists image_url text,
  add column if not exists source_domain text,
  add column if not exists ref_price_cents integer,
  add column if not exists ref_price_currency text;

comment on column public.mod_items.status is
  'installed | removed. Removal is a state, not a delete: the row keeps its id so listings, updates and the public build sheet can still name the part.';
comment on column public.mod_items.removed_at is
  'When the part came off. Set exactly when status = removed.';
comment on column public.mod_items.source_order_item_id is
  'The order item this mod was built from (C-1). Unique, so adding a purchase to a car twice is a no-op.';
comment on column public.mod_items.product_url is
  'Where the owner pasted this part from. Displayed as a plain link out; never used as a listing photo source.';
comment on column public.mod_items.image_url is
  'Thumbnail imported from the product link, in DRVN storage. A shop product photo must never become a listing photo (L-4).';
comment on column public.mod_items.source_domain is
  'Host the link came from, for the "via <shop>" line.';
comment on column public.mod_items.ref_price_cents is
  'What the shop listed it at when the link was read. Reference only — not a DRVN price.';
comment on column public.mod_items.ref_price_currency is
  'ISO-4217 code for ref_price_cents. No currency means no price: the check below refuses the ambiguous half-state.';

-- ============================================================
-- 2. Invariants
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mod_items_status_check'
  ) then
    alter table public.mod_items
      add constraint mod_items_status_check
      check (status in ('installed', 'removed'));
  end if;

  -- removed_at and status can never disagree, in either direction.
  if not exists (
    select 1 from pg_constraint where conname = 'mod_items_removed_at_agrees_check'
  ) then
    alter table public.mod_items
      add constraint mod_items_removed_at_agrees_check
      check ((status = 'removed') = (removed_at is not null));
  end if;

  -- A price without a currency is not a price (L-2).
  if not exists (
    select 1 from pg_constraint where conname = 'mod_items_ref_price_currency_check'
  ) then
    alter table public.mod_items
      add constraint mod_items_ref_price_currency_check
      check (
        ref_price_cents is null
        or (ref_price_currency is not null and ref_price_cents >= 0)
      );
  end if;
end;
$$;

-- One purchase line can furnish one mod (C-1 idempotency).
create unique index if not exists mod_items_source_order_item_key
  on public.mod_items (source_order_item_id)
  where source_order_item_id is not null;

-- Every reader that filters by state does it per car.
create index if not exists mod_items_car_status_position_idx
  on public.mod_items (car_id, status, position);

-- ============================================================
-- 3. save_mod_items — re-created once, carrying the new columns
-- ============================================================
-- Differences from 20260905224929, and nothing else:
--   * status / removed_at parsed and validated per line;
--   * the link columns parsed per line;
--   * removed_at derived, never taken from the client — a row that is already
--     removed keeps its original timestamp when the sheet is saved again, so
--     "came off this car" doesn't drift to today on every edit.
-- The delete statement is unchanged on purpose: the editor keeps sending
-- removed rows with their status, so omitting a row still means delete.
create or replace function public.save_mod_items(p_car_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_expected integer;
  v_written integer;
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
    where nullif(item->>'ref_price_cents', '') is not null
      and (
        nullif(btrim(item->>'ref_price_currency'), '') is null
        or (item->>'ref_price_cents')::integer < 0
      )
  ) then
    raise exception 'A reference price needs a currency.' using errcode = '22023';
  end if;

  delete from public.mod_items existing
  where existing.car_id = p_car_id
    and not exists (
      select 1
      from jsonb_array_elements(v_items) item
      where (item->>'id')::uuid = existing.id
    );

  insert into public.mod_items (
    id, car_id, group_label, category, brand, product, part_number,
    raw_text, confidence, position, status, removed_at,
    product_url, image_url, source_domain, ref_price_cents, ref_price_currency,
    updated_at
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
    updated_at = excluded.updated_at
  where public.mod_items.car_id = excluded.car_id;

  get diagnostics v_written = row_count;
  if v_written <> v_expected then
    raise exception 'The modification sheet changed while it was being saved.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'outcome', 'saved',
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
$$;

commit;
