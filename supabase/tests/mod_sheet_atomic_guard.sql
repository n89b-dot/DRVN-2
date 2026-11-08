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

-- ============================================================
-- Record identity (PRD 2026-09 A-1/A-2, migration 20260919170000)
--
-- Removal is a state, not a delete. These checks exist because the obvious
-- implementation — drop the row — is exactly what the product can no longer
-- afford: a build sheet has to be able to say "came off this car", and a
-- listing has to keep pointing at the line it was released from.
-- ============================================================
do $$
declare
  owner_id uuid := gen_random_uuid();
  v_car_id uuid := gen_random_uuid();
  kept_id uuid := gen_random_uuid();
  replaced_id uuid := gen_random_uuid();
  fresh_id uuid := gen_random_uuid();
  doomed_id uuid := gen_random_uuid();
  stale_listing_id uuid := gen_random_uuid();
  first_removed_at timestamptz;
  second_removed_at timestamptz;
  rejected boolean;
  function_payload jsonb;
begin
  -- Beta enforcement is already off for this transaction (the block above
  -- cleared it), so this block only has to drop back to the session role.
  reset role;
  insert into auth.users(id, email) values (owner_id, 'mod-identity-owner@drvn.test');
  insert into public.profiles(id, username) values (owner_id, 'mod_identity_owner')
    on conflict (id) do update set username = excluded.username;
  insert into public.cars(id, owner_id, slug, name)
  values(v_car_id, owner_id, 'mod-identity-guard', 'Mod identity guard');

  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', owner_id, 'role', 'authenticated')::text,
    true
  );

  -- Three installed lines to start.
  function_payload := jsonb_build_array(
    jsonb_build_object('id', kept_id, 'group_label', 'Other', 'brand', 'Guard', 'product', 'Kept'),
    jsonb_build_object('id', replaced_id, 'group_label', 'Other', 'brand', 'Guard', 'product', 'Original'),
    jsonb_build_object('id', doomed_id, 'group_label', 'Other', 'brand', 'Guard', 'product', 'Doomed')
  );
  perform public.save_mod_items(v_car_id, function_payload);

  perform set_config('role', 'none', true);
  if exists (select 1 from public.mod_items where car_id = v_car_id and status <> 'installed') then
    raise exception 'A new modification line did not default to installed';
  end if;
  if exists (select 1 from public.mod_items where car_id = v_car_id and removed_at is not null) then
    raise exception 'An installed modification line carries a removal date';
  end if;

  -- A line that has been released for sale, to prove the link survives.
  update public.mod_items set linked_listing_id = null where id = kept_id;

  -- REPLACE: the old line is marked removed and keeps its id; a new id takes
  -- its position. DELETE: `doomed_id` is simply omitted.
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', owner_id, 'role', 'authenticated')::text,
    true
  );
  perform public.save_mod_items(v_car_id, jsonb_build_array(
    jsonb_build_object('id', kept_id, 'group_label', 'Other', 'brand', 'Guard', 'product', 'Kept'),
    jsonb_build_object('id', fresh_id, 'group_label', 'Other', 'brand', 'Guard', 'product', 'Replacement'),
    jsonb_build_object('id', replaced_id, 'group_label', 'Other', 'brand', 'Guard',
                       'product', 'Original', 'status', 'removed')
  ));

  perform set_config('role', 'none', true);
  if not exists (
    select 1 from public.mod_items
    where id = replaced_id and status = 'removed' and removed_at is not null
      and product = 'Original'
  ) then
    raise exception 'Replace did not preserve the old line as a removed record';
  end if;
  if not exists (select 1 from public.mod_items where id = fresh_id and status = 'installed') then
    raise exception 'Replace did not file the replacement as its own line';
  end if;
  if exists (select 1 from public.mod_items where id = doomed_id) then
    raise exception 'Omitting a line no longer deletes it — the delete statement changed';
  end if;

  select removed_at into first_removed_at from public.mod_items where id = replaced_id;

  -- Saving the sheet again must not move the date the part came off.
  perform pg_sleep(0.05);
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', owner_id, 'role', 'authenticated')::text,
    true
  );
  perform public.save_mod_items(v_car_id, jsonb_build_array(
    jsonb_build_object('id', kept_id, 'group_label', 'Other', 'brand', 'Guard', 'product', 'Kept'),
    jsonb_build_object('id', fresh_id, 'group_label', 'Other', 'brand', 'Guard', 'product', 'Replacement'),
    jsonb_build_object('id', replaced_id, 'group_label', 'Other', 'brand', 'Guard',
                       'product', 'Original', 'status', 'removed')
  ));

  perform set_config('role', 'none', true);
  select removed_at into second_removed_at from public.mod_items where id = replaced_id;
  if second_removed_at is distinct from first_removed_at then
    raise exception 'Re-saving the sheet moved the date a part came off';
  end if;

  -- A reference price without a currency is not a price.
  rejected := false;
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', owner_id, 'role', 'authenticated')::text,
    true
  );
  begin
    perform public.save_mod_items(v_car_id, jsonb_build_array(
      jsonb_build_object('id', kept_id, 'group_label', 'Other', 'brand', 'Guard',
                         'product', 'Kept', 'ref_price_cents', 12000)
    ));
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'A reference price was accepted with no currency'; end if;

  -- An unknown state is refused outright rather than silently installed.
  rejected := false;
  begin
    perform public.save_mod_items(v_car_id, jsonb_build_array(
      jsonb_build_object('id', kept_id, 'group_label', 'Other', 'brand', 'Guard',
                         'product', 'Kept', 'status', 'binned')
    ));
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'An unknown modification state was accepted'; end if;

  perform set_config('role', 'none', true);

  -- C-1's idempotency rests on this index; the flow itself is guarded where
  -- order fixtures exist.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'mod_items_source_order_item_key'
  ) then
    raise exception 'The purchase-to-mod uniqueness index is missing';
  end if;

  -- A sheet left open in another tab omits rows it never loaded. A line that
  -- has since been released for sale must survive that save (A-1), with its
  -- link intact.
  reset role;
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, currency, status)
  values (stale_listing_id, owner_id, 'Guard part', 'performance', 10000, 0, 'USD', 'draft');
  update public.mod_items set linked_listing_id = stale_listing_id where id = kept_id;

  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', owner_id, 'role', 'authenticated')::text,
    true
  );
  perform public.save_mod_items(v_car_id, jsonb_build_array(
    jsonb_build_object('id', fresh_id, 'group_label', 'Other', 'brand', 'Guard', 'product', 'Replacement')
  ));
  perform set_config('role', 'none', true);
  if not exists (
    select 1 from public.mod_items where id = kept_id and linked_listing_id = stale_listing_id
  ) then
    raise exception 'A stale sheet erased a line that is listed for sale';
  end if;
  if exists (select 1 from public.mod_items where id = replaced_id) then
    raise exception 'An omitted, unlisted line was not deleted';
  end if;

  raise notice 'all modification record identity checks passed';
end;
$$;

rollback;
