-- "What came off": a build-sheet line says whether it is aftermarket or a
-- stock part that came off (20261019100000). Disposable local DB only.
begin;

-- save_mod_items takes the revision the editor loaded (N65, 20261107220100).
-- These checks are about what one save does, so each passes the current one.
create function pg_temp.save_sheet(p_car uuid, p_items jsonb) returns jsonb
language sql as $$ select public.save_mod_items(p_car, p_items, public.mod_sheet_revision(p_car)) $$;

do $$
declare
  owner_id uuid := gen_random_uuid();
  v_car_id uuid := gen_random_uuid();
  mod_id uuid := gen_random_uuid();
  stock_id uuid := gen_random_uuid();
  rejected boolean := false;
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mod_items_origin_check'
      and conrelid = 'public.mod_items'::regclass
  ) then
    raise exception 'mod_items.origin has no check constraint';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.save_mod_items(uuid,jsonb,text)'::regprocedure) then
    raise exception 'Modification sheet function bypasses caller RLS';
  end if;

  insert into auth.users(id, email) values (owner_id, 'stock-origin-owner@drvn.test');
  insert into public.profiles(id, username) values (owner_id, 'stock_origin_owner')
  on conflict (id) do update set username = excluded.username;
  insert into public.cars(id, owner_id, slug, name, make)
  values (v_car_id, owner_id, 'stock-origin-guard', 'Stock origin guard', 'Honda');

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);

  -- A new mod, and the stock springs it replaced, saved together.
  perform pg_temp.save_sheet(v_car_id, jsonb_build_array(
    jsonb_build_object('id', mod_id, 'group_label', 'Suspension', 'category', 'suspension',
      'brand', 'Eibach', 'product', 'Pro-Kit springs', 'raw_text', 'Eibach Pro-Kit springs'),
    jsonb_build_object('id', stock_id, 'group_label', 'Suspension', 'category', 'suspension',
      'brand', 'Honda', 'product', 'Stock springs ×4', 'raw_text', 'Stock springs ×4',
      'status', 'removed', 'origin', 'stock')
  ));
  perform set_config('role', 'none', true);
  if (select origin from public.mod_items where id = mod_id) <> 'aftermarket' then
    raise exception 'A line saved without origin is not aftermarket';
  end if;
  if (select origin || ':' || status || ':' || (removed_at is not null)::text
        from public.mod_items where id = stock_id) <> 'stock:removed:true' then
    raise exception 'A stock line did not save as a removed stock part';
  end if;

  -- An editor that predates origin sends the same lines without it: the
  -- stock line stays stock.
  perform set_config('role', 'authenticated', true);
  perform pg_temp.save_sheet(v_car_id, jsonb_build_array(
    jsonb_build_object('id', mod_id, 'group_label', 'Suspension', 'category', 'suspension',
      'brand', 'Eibach', 'product', 'Pro-Kit springs', 'raw_text', 'Eibach Pro-Kit springs'),
    jsonb_build_object('id', stock_id, 'group_label', 'Suspension', 'category', 'suspension',
      'brand', 'Honda', 'product', 'Stock springs ×4', 'raw_text', 'Stock springs ×4',
      'status', 'removed')
  ));
  perform set_config('role', 'none', true);
  if (select origin from public.mod_items where id = stock_id) <> 'stock' then
    raise exception 'A save without origin reset a stock line to aftermarket';
  end if;

  -- Anything else is refused.
  perform set_config('role', 'authenticated', true);
  begin
    perform pg_temp.save_sheet(v_car_id, jsonb_build_array(
      jsonb_build_object('id', mod_id, 'group_label', 'Suspension', 'raw_text', 'x', 'origin', 'oem')
    ));
  exception when sqlstate '22023' then
    rejected := true;
  end;
  perform set_config('role', 'none', true);
  if not rejected then
    raise exception 'An unknown origin was accepted';
  end if;

  raise notice 'all mod stock origin checks passed';
end $$;

rollback;
