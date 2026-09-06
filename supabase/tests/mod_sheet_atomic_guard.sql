-- Transactional/idempotent modification-sheet guard. Disposable local DB only.
begin;

create or replace function pg_temp.reject_mod_write()
returns trigger language plpgsql as $$
begin
  if new.product = 'FAIL_WRITE' then
    raise exception 'injected mod write failure';
  end if;
  return new;
end;
$$;

create trigger mod_sheet_injected_failure
before insert or update on public.mod_items
for each row execute function pg_temp.reject_mod_write();

do $$
declare
  owner_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  v_car_id uuid := gen_random_uuid();
  first_id uuid := gen_random_uuid();
  second_id uuid := gen_random_uuid();
  third_id uuid := gen_random_uuid();
  initial_payload jsonb;
  rejected boolean := false;
begin
  if (select prosecdef from pg_proc where oid = 'public.save_mod_items(uuid,jsonb)'::regprocedure) then
    raise exception 'Modification sheet function bypasses caller RLS';
  end if;
  if has_function_privilege('anon', 'public.save_mod_items(uuid,jsonb)', 'execute') then
    raise exception 'Anonymous callers can save modification sheets';
  end if;

  update public.beta_access_config set enforced = false where singleton;
  insert into auth.users(id, email) values
    (owner_id, 'mod-sheet-owner@drvn.test'),
    (outsider_id, 'mod-sheet-outsider@drvn.test');
  insert into public.profiles(id, username)
  values
    (owner_id, 'mod_sheet_owner'),
    (outsider_id, 'mod_sheet_outsider')
  on conflict (id) do update set username = excluded.username;
  insert into public.cars(id, owner_id, slug, name)
  values(v_car_id, owner_id, 'mod-sheet-guard', 'Mod sheet guard');

  initial_payload := jsonb_build_array(
    jsonb_build_object(
      'id', first_id, 'group_label', 'Performance', 'category', 'intake',
      'brand', 'Guard', 'product', 'Intake', 'part_number', 'A-1',
      'raw_text', 'Guard Intake', 'confidence', 0.9
    ),
    jsonb_build_object(
      'id', second_id, 'group_label', 'Suspension', 'category', 'suspension',
      'brand', 'Guard', 'product', 'Coilovers', 'part_number', 'B-2',
      'raw_text', 'Guard Coilovers', 'confidence', 0.8
    )
  );

  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', owner_id, 'role', 'authenticated')::text,
    true
  );
  perform public.save_mod_items(v_car_id, initial_payload);
  perform public.save_mod_items(v_car_id, initial_payload);

  perform set_config('role', 'none', true);
  if (select count(*) from public.mod_items where car_id = v_car_id) <> 2 then
    raise exception 'Repeated stable-id save duplicated modification lines';
  end if;
  if (select array_agg(id order by position) from public.mod_items where car_id = v_car_id)
     <> array[first_id, second_id] then
    raise exception 'Modification sheet order or identities did not persist';
  end if;

  -- The function deletes omitted rows before its upsert. Force the upsert to
  -- fail and prove the earlier delete rolls back with the rest of the call.
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', owner_id, 'role', 'authenticated')::text,
    true
  );
  begin
    perform public.save_mod_items(
      v_car_id,
      jsonb_build_array(
        jsonb_build_object(
          'id', second_id, 'group_label', 'Suspension', 'category', 'suspension',
          'brand', 'Guard', 'product', 'FAIL_WRITE', 'raw_text', 'Injected failure'
        ),
        jsonb_build_object(
          'id', third_id, 'group_label', 'Other', 'category', null,
          'brand', 'Guard', 'product', 'New line', 'raw_text', 'New line'
        )
      )
    );
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'Injected write failure was accepted'; end if;

  perform set_config('role', 'none', true);
  if (select count(*) from public.mod_items where car_id = v_car_id) <> 2
     or not exists(select 1 from public.mod_items where id = first_id and product = 'Intake')
     or not exists(select 1 from public.mod_items where id = second_id and product = 'Coilovers') then
    raise exception 'Failed modification save partially changed the sheet';
  end if;

  rejected := false;
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', outsider_id, 'role', 'authenticated')::text,
    true
  );
  begin
    perform public.save_mod_items(v_car_id, initial_payload);
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then raise exception 'Non-owner saved another member''s modification sheet'; end if;

  raise notice 'all atomic modification sheet checks passed';
end;
$$;

rollback;
