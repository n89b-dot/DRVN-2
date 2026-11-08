-- A part's place in Newest and in saved-search alerts is when it first went
-- on sale, not when its row was made (N73; migration 20261107153200).
-- Transactional; disposable local database only.
--
-- A draft saved ten days ago and published now must lead Newest, reach a
-- saved-search window that opened after it was saved, keep its place through
-- a pause, and carry the same date into listing_vehicle_fit and the search
-- engine's documents. The date is the database's: a writer can't set it.
begin;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_car uuid := gen_random_uuid();
  v_make bigint; v_model bigint;
  v_old uuid; v_draft uuid; v_future uuid;
  v_published timestamptz;
  v_since timestamptz := now() - interval '2 days';
  got uuid[];
  doc jsonb;
begin
  insert into auth.users(id, email) values (v_seller, 'published-seller@drvn.test');
  insert into public.profiles(id, username) values (v_seller, 'published_seller')
    on conflict (id) do update set username = excluded.username;
  insert into public.catalog_makes(name) values ('Zzpubmake') returning id into v_make;
  insert into public.catalog_models(make_id, name) values (v_make, 'Zzpubmodel') returning id into v_model;
  insert into public.cars(id, owner_id, slug, name, make, model, year, is_public) values
    (v_car, v_seller, 'published-car', 'Published car', 'Zzpubmake', 'Zzpubmodel', 2004, true);

  -- 1. Inserted for sale: published as created. Inserted as a draft: not yet.
  --    A future creation date can't date a part past now.
  insert into public.listings(seller_id, source_car_id, title, category, price_cents, currency, status, brand, created_at)
  values (v_seller, v_car, 'Zzpub listed three days ago', 'engine', 1000, 'USD', 'active', 'Zzpubbrand', now() - interval '3 days')
  returning id into v_old;
  insert into public.listings(seller_id, source_car_id, title, category, price_cents, currency, status, brand, created_at)
  values (v_seller, v_car, 'Zzpub drafted ten days ago', 'engine', 1000, 'USD', 'draft', 'Zzpubbrand', now() - interval '10 days')
  returning id into v_draft;
  insert into public.listings(seller_id, source_car_id, title, category, price_cents, currency, status, brand, created_at, published_at)
  values (v_seller, v_car, 'Zzpub dated ahead', 'engine', 1000, 'USD', 'active', 'Zzpubbrand', now() + interval '1 year', now() + interval '1 year')
  returning id into v_future;

  if (select published_at from public.listings where id = v_old) is distinct from now() - interval '3 days' then
    raise exception 'FAIL 1a: a part inserted for sale is not published at its creation';
  end if;
  if (select published_at from public.listings where id = v_draft) is not null then
    raise exception 'FAIL 1b: a draft has a publication time';
  end if;
  if (select published_at from public.listings where id = v_future) > now() then
    raise exception 'FAIL 1c: a writer dated a part into the future';
  end if;

  -- 2. The writer can't move it.
  update public.listings set published_at = now() + interval '1 year' where id = v_old;
  update public.listings set published_at = now() where id = v_draft;
  if (select published_at from public.listings where id = v_old) is distinct from now() - interval '3 days'
     or (select published_at from public.listings where id = v_draft) is not null then
    raise exception 'FAIL 2: a writer changed published_at';
  end if;

  -- 3. Publishing the old draft stamps it now; pausing and relisting keep it.
  update public.listings set status = 'active' where id = v_draft;
  select published_at into v_published from public.listings where id = v_draft;
  if v_published is distinct from now() then
    raise exception 'FAIL 3a: publishing a draft did not stamp published_at: %', v_published;
  end if;
  update public.listings set status = 'paused' where id = v_draft;
  update public.listings set status = 'active' where id = v_draft;
  if (select published_at from public.listings where id = v_draft) is distinct from v_published then
    raise exception 'FAIL 3b: pause and relist moved the first publication time';
  end if;

  -- 1d. A part dated ahead is clamped in its vehicle rows too (the
  --     migration re-copies existing rows; the trigger copies new ones), so
  --     vehicle-filtered Newest orders by the same time its position holds.
  if (select published_at from public.listing_vehicle_fit where listing_id = v_future limit 1)
     is distinct from (select published_at from public.listings where id = v_future)
     or (select max(published_at) from public.listing_vehicle_fit where listing_id = v_future) > now() then
    raise exception 'FAIL 1d: listing_vehicle_fit holds a part''s future date, not its publication time';
  end if;
  delete from public.listings where id = v_future;

  -- 4. Newest: the just-published draft leads, by every read path.
  got := array(select id from public.marketplace_page(p_query => '', p_brand => 'Zzpubbrand', p_sort => 'newest', p_limit => 10));
  if got is distinct from array[v_draft, v_old] then
    raise exception 'FAIL 4a: Newest by brand is not by publication: %', got;
  end if;
  got := array(select id from public.marketplace_page(p_query => '', p_vehicle => v_make || '-' || v_model, p_sort => 'newest', p_limit => 10));
  if got is distinct from array[v_draft, v_old] then
    raise exception 'FAIL 4b: Newest for a vehicle (listing_vehicle_fit order) is not by publication: %', got;
  end if;
  got := array(select id from public.marketplace_page(p_query => 'Zzpub', p_sort => 'newest', p_limit => 10));
  if got is distinct from array[v_draft, v_old] then
    raise exception 'FAIL 4c: Newest for a typed search is not by publication: %', got;
  end if;
  -- The next page starts after the first part's publication time.
  got := array(select id from public.marketplace_page(p_query => '', p_brand => 'Zzpubbrand', p_sort => 'newest', p_limit => 10,
                 p_after_created => v_published, p_after_id => v_draft));
  if got is distinct from array[v_old] then
    raise exception 'FAIL 4d: paging by position does not follow publication order: %', got;
  end if;
  if exists (select 1 from public.listing_vehicle_fit f join public.listings l on l.id = f.listing_id
             where f.listing_id in (v_draft, v_old) and f.published_at is distinct from l.published_at)
     or not exists (select 1 from public.listing_vehicle_fit where listing_id = v_draft) then
    raise exception 'FAIL 4e: listing_vehicle_fit does not hold the publication time';
  end if;

  -- 5. The saved-search window (api/jobs/saved-searches): a window that
  --    opened after the draft was saved still finds it, by publication.
  got := array(select id from public.marketplace_browse_rows(p_query => '')
               where brand = 'Zzpubbrand' and published_at > v_since and published_at <= now());
  if got is distinct from array[v_draft] then
    raise exception 'FAIL 5: the saved-search window missed a part published from a draft: %', got;
  end if;

  -- 6. The engine's document carries it.
  select d.doc into doc from public.search_listing_documents(array[v_draft]) d;
  if (doc->>'published_at_us')::bigint is distinct from (extract(epoch from v_published) * 1000000)::bigint then
    raise exception 'FAIL 6: the search document has no publication time: %', doc->>'published_at_us';
  end if;

  -- 7. Nothing that has left draft is without one (the backfill and the
  --    trigger), and every vehicle row holds its part's time, existing rows
  --    included (the migration's re-copy).
  if exists (select 1 from public.listings where status <> 'draft' and published_at is null) then
    raise exception 'FAIL 7a: a part off draft has no publication time';
  end if;
  if exists (select 1 from public.listing_vehicle_fit f join public.listings l on l.id = f.listing_id
             where f.published_at is distinct from l.published_at) then
    raise exception 'FAIL 7b: a listing_vehicle_fit row holds a different time from its part';
  end if;

  raise notice 'all listing publication time checks passed';
end;
$$;

rollback;
