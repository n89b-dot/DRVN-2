-- OS-W28 OS-R-arrival: a counted listing view records the surface it came
-- from, under bump_listing_view's rules, with no viewer ids
-- (20261107220200).
begin;

do $$
declare
  viewer uuid := gen_random_uuid();
  other_viewer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  part uuid := gen_random_uuid();
  draft uuid := gen_random_uuid();
  counted boolean;
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (viewer, 'w28-viewer@drvn.test', '{}'),
    (other_viewer, 'w28-other@drvn.test', '{}'),
    (seller, 'w28-seller@drvn.test', '{}');
  insert into public.listings(id, seller_id, title, category, price_cents, status) values
    (part, seller, 'W28 part', 'performance', 5000, 'active'),
    (draft, seller, 'W28 draft', 'performance', 5000, 'draft');

  if has_function_privilege('anon', 'public.record_listing_view(uuid,text)', 'execute') then
    raise exception 'FAIL 1: visitors can call record_listing_view';
  end if;
  if has_table_privilege('authenticated', 'public.listing_view_arrivals', 'select')
     or has_table_privilege('anon', 'public.listing_view_arrivals', 'select') then
    raise exception 'FAIL 2: clients can read the arrival counts';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'listing_view_arrivals'
                and column_name ~ '(user|viewer|member|profile)') then
    raise exception 'FAIL 3: arrival counts hold a viewer id';
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  counted := public.record_listing_view(part, 'car');
  if not counted then raise exception 'FAIL 4: a member''s first view was not counted'; end if;
  -- Within the hour the same member's look is not counted again, from anywhere.
  if public.record_listing_view(part, 'post') then raise exception 'FAIL 5: a repeat view was counted'; end if;
  -- An unknown surface is filed as other, never stored as typed.
  perform set_config('request.jwt.claims', json_build_object('sub', other_viewer, 'role', 'authenticated')::text, true);
  perform public.record_listing_view(part, 'https://evil.test/');
  -- Drafts and the seller's own views never count.
  if public.record_listing_view(draft, 'car') then raise exception 'FAIL 6: a draft view was counted'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  if public.record_listing_view(part, 'store') then raise exception 'FAIL 7: the seller''s own view was counted'; end if;
  perform set_config('role', 'none', true);

  if (select view_count from public.listings where id = part) <> 2 then
    raise exception 'FAIL 8: view_count is %, not 2', (select view_count from public.listings where id = part);
  end if;
  if (select coalesce(sum(views), 0) from public.listing_view_arrivals where listing_id = part and arrival = 'car') <> 1
     or (select coalesce(sum(views), 0) from public.listing_view_arrivals where listing_id = part and arrival = 'other') <> 1
     or (select coalesce(sum(views), 0) from public.listing_view_arrivals where listing_id = part) <> 2
     or exists (select 1 from public.listing_view_arrivals where listing_id = draft) then
    raise exception 'FAIL 9: arrival counts do not match the counted views';
  end if;
  -- bump_listing_view shares the hourly key, so the two can't double count.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  perform public.bump_listing_view(part);
  perform set_config('role', 'none', true);
  if (select view_count from public.listings where id = part) <> 2 then
    raise exception 'FAIL 10: bump_listing_view double counted a view record_listing_view counted';
  end if;

  raise notice 'all listing view arrival checks passed';
end $$;

rollback;
