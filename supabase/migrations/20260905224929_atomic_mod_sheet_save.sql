-- Save the complete modification sheet as one caller-scoped transaction.
-- Stable client UUIDs make a repeated request converge after a lost response.
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

  delete from public.mod_items existing
  where existing.car_id = p_car_id
    and not exists (
      select 1
      from jsonb_array_elements(v_items) item
      where (item->>'id')::uuid = existing.id
    );

  insert into public.mod_items (
    id, car_id, group_label, category, brand, product, part_number,
    raw_text, confidence, position, updated_at
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
    updated_at = excluded.updated_at
  where public.mod_items.car_id = excluded.car_id;

  get diagnostics v_written = row_count;
  if v_written <> v_expected then
    raise exception 'The modification sheet changed while it was being saved.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'outcome', 'saved',
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', item.id, 'position', item.position) order by item.position)
      from public.mod_items item
      where item.car_id = p_car_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.save_mod_items(uuid, jsonb) from public, anon;
grant execute on function public.save_mod_items(uuid, jsonb) to authenticated;
