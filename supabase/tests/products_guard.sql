-- Products with brand-aware identity and build-line part keys
-- (20261020110000, 20261020120000). Transactional; disposable database only.
--
-- Only the same brand + number, a brand-scoped same_product link or an
-- admin's decision put two records in one product. Interchange, supersedes
-- and aftermarket links stay edges. What's ambiguous is filed for review,
-- once, and closes itself when it stops being ambiguous. Admins decide
-- with a step-up and leave an audit row. No client reads or writes any of
-- it, and none of it moves vehicle fit.
begin;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_car uuid := gen_random_uuid();
  l_bosch uuid := gen_random_uuid();
  l_bosch_caps uuid := gen_random_uuid();
  l_delphi uuid := gen_random_uuid();
  l_nobrand uuid := gen_random_uuid();
  l_word uuid := gen_random_uuid();
  l_draft uuid := gen_random_uuid();
  l_removed uuid := gen_random_uuid();
  l_ate uuid := gen_random_uuid();
  l_alt_a uuid := gen_random_uuid();
  l_alt_b uuid := gen_random_uuid();
  l_kw uuid := gen_random_uuid();
  l_bil uuid := gen_random_uuid();
  l_x uuid := gen_random_uuid();
  l_y uuid := gen_random_uuid();
  m_bosch uuid := gen_random_uuid();
  m_ohlins uuid := gen_random_uuid();
  v_run jsonb;
  v_p uuid;
  v_q uuid;
  v_review uuid;
  v_brandless uuid;
  v_unscoped uuid;
  v_n int;
  v_fit_before text;
  v_fit_after text;
  v_snapshot jsonb;
  v_admin_claims text;
  denied boolean;
begin
  insert into auth.users(id, email) values (v_seller, 'products-seller@example.test'), (v_admin, 'products-admin@example.test');
  insert into public.admin_users(user_id, note) values (v_admin, 'products guard');
  insert into public.cars(id, owner_id, name, slug, is_public, make, model, year)
  values (v_car, v_seller, 'Project', 'products-guard-car', true, 'Volkswagen', 'Golf', 2016);

  -- 1. Build lines get the listings' part-number key and a compacted brand.
  insert into public.mod_items(id, car_id, brand, product, part_number)
  values (m_bosch, v_car, '-Bosch', 'EV14 injectors', '0 280-158 117'),
         (m_ohlins, v_car, 'Öhlins', 'Road & Track', 'VWS MU00');
  if (select part_number_compact from public.mod_items where id = m_bosch) is distinct from '0280158117'
     or (select brand_key from public.mod_items where id = m_bosch) is distinct from 'bosch' then
    raise exception 'FAIL 1a: build-line part keys are wrong';
  end if;
  if (select brand_key from public.mod_items where id = m_ohlins) is distinct from 'öhlins' then
    raise exception 'FAIL 1b: a brand outside ASCII lost its letters: %', (select brand_key from public.mod_items where id = m_ohlins);
  end if;

  insert into public.listings(id, seller_id, source_car_id, title, category, condition, price_cents, status, brand, part_number)
  values (l_bosch, v_seller, v_car, 'Bosch EV14 injectors', 'performance', 'used', 30000, 'active', 'Bosch', '0280-158-117'),
         (l_bosch_caps, v_seller, null, 'BOSCH injectors, set of 4', 'performance', 'used', 28000, 'sold', 'BOSCH', '0280158117'),
         (l_delphi, v_seller, null, 'Delphi part sharing the number', 'performance', 'used', 9000, 'active', 'Delphi', '0280158117'),
         (l_nobrand, v_seller, null, 'Injector, no brand given', 'performance', 'used', 7000, 'active', null, '0280.158.117'),
         (l_word, v_seller, null, 'Kit', 'performance', 'used', 7000, 'active', 'KW', 'kit'),
         (l_draft, v_seller, null, 'Draft', 'performance', 'used', 7000, 'draft', 'Brembo', 'BR-5555'),
         (l_removed, v_seller, null, 'Removed', 'performance', 'used', 7000, 'active', 'Brembo', 'BR-6666'),
         (l_ate, v_seller, null, 'Bosch fuel pump', 'performance', 'used', 7000, 'active', 'Bosch', '0986AB1234'),
         (l_alt_a, v_seller, null, 'Bosch sensor', 'performance', 'used', 5000, 'active', 'Bosch', 'B1001'),
         (l_alt_b, v_seller, null, 'Bosch sensor, newer number', 'performance', 'used', 5000, 'active', 'Bosch', 'B1002'),
         (l_kw, v_seller, null, 'KW damper', 'brakes-suspension', 'used', 5000, 'active', 'KW', '35220001'),
         (l_bil, v_seller, null, 'Bilstein damper', 'brakes-suspension', 'used', 5000, 'active', 'Bilstein', '24-123456'),
         (l_x, v_seller, null, 'Brand X part', 'performance', 'used', 5000, 'active', 'Brand X', 'X-100'),
         (l_y, v_seller, null, 'Brand Y part', 'performance', 'used', 5000, 'active', 'Brand Y', 'Y-200');
  update public.listings set status = 'removed' where id = l_removed;
  insert into public.listing_part_numbers(listing_id, number) values (l_alt_a, 'B-1002');
  insert into public.part_number_links(from_compact, to_compact, kind, source, from_brand_key, to_brand_key) values
    ('35220001', '24123456', 'interchange', 'guard', 'kw', 'bilstein'),
    ('35220001', '24123456', 'aftermarket_equivalent', 'guard', 'kw', 'bilstein'),
    ('0280158117', '0986ab1234', 'same_product', 'guard', 'bosch', 'bosch'),
    ('0986ab1234', '0986ab9999', 'same_product', 'guard', 'bosch', 'bosch'),
    ('x100', 'y200', 'same_product', 'guard', null, null);

  select string_agg(format('%s|%s|%s|%s', listing_id, make_key, model_key, via), ',' order by listing_id, make_key, model_key, via)
    into v_fit_before from public.listing_vehicle_fit;

  -- 2. Grow.
  v_run := public.grow_products();
  select pm.product_id into v_p from public.product_part_numbers pm where pm.brand_key = 'bosch' and pm.number_compact = '0280158117';
  if v_p is null then raise exception 'FAIL 2a: no product for Bosch 0280158117'; end if;
  -- Same brand + number across spellings, a sold listing and a build line: one product.
  if (select count(*) from public.product_part_numbers pm where pm.number_compact = '0280158117' and pm.brand_key = 'bosch') <> 1 then
    raise exception 'FAIL 2b: Bosch 0280158117 split across products';
  end if;
  -- The brand-scoped same_product link merged the fuel pump in, and its
  -- chained link added a number nobody has written yet.
  if (select product_id from public.product_part_numbers where brand_key = 'bosch' and number_compact = '0986ab1234') is distinct from v_p then
    raise exception 'FAIL 2c: a brand-scoped same_product link did not merge';
  end if;
  if (select product_id from public.product_part_numbers where brand_key = 'bosch' and number_compact = '0986ab9999') is distinct from v_p
     or (select basis from public.product_part_numbers where brand_key = 'bosch' and number_compact = '0986ab9999') <> 'same_product_link' then
    raise exception 'FAIL 2d: a linked number was not added to the product';
  end if;
  if (select count(*) from public.products where status = 'merged' and brand_key = 'bosch') <> 1 then raise exception 'FAIL 2e: expected one merged product'; end if;
  -- Delphi's part with the same number is a different product.
  select product_id into v_q from public.product_part_numbers where brand_key = 'delphi' and number_compact = '0280158117';
  if v_q is null or v_q = v_p then raise exception 'FAIL 2f: another brand''s part merged by number'; end if;
  -- Interchange and aftermarket links are edges, not identity.
  if (select product_id from public.product_part_numbers where brand_key = 'kw' and number_compact = '35220001')
     = (select product_id from public.product_part_numbers where brand_key = 'bilstein' and number_compact = '24123456') then
    raise exception 'FAIL 2g: an interchange link merged two products';
  end if;
  -- Not part numbers, drafts and removed listings start nothing; the build line's own brand-number pair does.
  if exists (select 1 from public.product_part_numbers where number_compact in ('kit', 'br5555', 'br6666')) then
    raise exception 'FAIL 2h: a word, a draft or a removed listing started a product';
  end if;
  if not exists (select 1 from public.product_part_numbers where brand_key = 'öhlins' and number_compact = 'vwsmu00') then
    raise exception 'FAIL 2i: a build line''s part did not start a product';
  end if;
  if (select brand from public.products p join public.product_part_numbers pm on pm.product_id = p.id
      where pm.brand_key = 'öhlins') <> 'Öhlins' then
    raise exception 'FAIL 2j: the product lost its display brand';
  end if;

  -- 3. The ambiguous, filed once each.
  if not exists (select 1 from public.product_identity_reviews where kind = 'number_across_brands' and number_compact = '0280158117' and status = 'open') then
    raise exception 'FAIL 3a: two brands sharing a number were not filed';
  end if;
  if not exists (select 1 from public.product_identity_reviews where kind = 'brandless_number' and listing_id = l_nobrand) then
    raise exception 'FAIL 3b: a brandless known number was not filed';
  end if;
  if not exists (select 1 from public.product_identity_reviews where kind = 'unscoped_same_product' and number_compact = 'x100') then
    raise exception 'FAIL 3c: an unscoped same_product link was not filed';
  end if;
  if (select product_id from public.product_part_numbers where brand_key = 'brandx')
     = (select product_id from public.product_part_numbers where brand_key = 'brandy') then
    raise exception 'FAIL 3d: an unscoped same_product link merged';
  end if;
  if not exists (select 1 from public.product_identity_reviews where kind = 'listing_alternate' and listing_id = l_alt_a) then
    raise exception 'FAIL 3e: a listing''s alternate held by another product was not filed';
  end if;
  select count(*) into v_n from public.product_identity_reviews;
  v_run := public.grow_products();
  if (v_run ->> 'products_created')::int <> 0 or (v_run ->> 'reviews_opened')::int <> 0
     or (select count(*) from public.product_identity_reviews) <> v_n then
    raise exception 'FAIL 3f: a second run was not a no-op: %', v_run;
  end if;
  if (public.product_coverage() -> 'listings' ->> 'with_product')::int < 10 then
    raise exception 'FAIL 3g: coverage not measured: %', public.product_coverage();
  end if;
  -- A full run finds nothing new either, and records coverage.
  v_run := public.grow_products(true);
  if (v_run ->> 'products_created')::int <> 0 or (v_run ->> 'reviews_opened')::int <> 0 or not v_run ? 'coverage' then
    raise exception 'FAIL 3h: a full run after an incremental one disagreed: %', v_run;
  end if;

  -- 4. Clients see none of it.
  select id into v_review from public.product_identity_reviews where kind = 'number_across_brands' and number_compact = '0280158117';
  select id into v_brandless from public.product_identity_reviews where kind = 'brandless_number' and listing_id = l_nobrand;
  select id into v_unscoped from public.product_identity_reviews where kind = 'unscoped_same_product' and number_compact = 'x100';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  foreach v_admin_claims in array array['products', 'product_part_numbers', 'product_identity_reviews', 'product_grow_runs', 'part_number_links'] loop
    denied := false;
    begin
      execute format('select count(*) from public.%I', v_admin_claims) into v_n;
    exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception 'FAIL 4a: a member read %', v_admin_claims; end if;
  end loop;
  denied := false;
  begin perform public.grow_products(); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 4b: a member ran grow_products'; end if;
  -- A member who isn't an admin is refused a decision.
  denied := false;
  begin perform public.resolve_product_identity_review(v_review, 'merge', 'trying'); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 4c: a member resolved a review'; end if;

  -- 5. An admin without a fresh step-up is refused; with one, decides.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  denied := false;
  begin perform public.resolve_product_identity_review(v_review, 'merge', 'no step-up'); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 5a: a decision without a step-up was allowed'; end if;
  v_admin_claims := jsonb_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text;
  perform set_config('request.jwt.claims', v_admin_claims, true);
  perform public.resolve_product_identity_review(v_review, 'merge', 'Delphi number is a rebadged Bosch part (guard)');
  begin
    perform public.resolve_product_identity_review(v_review, 'keep_separate', 'again');
    raise exception 'FAIL 5b: a closed review was decided twice';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
      perform public.resolve_product_identity_review(v_brandless, 'merge', 'no');
    raise exception 'FAIL 5c: a brandless record was merged';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform public.resolve_product_identity_review(v_unscoped, 'keep_separate', 'Different makers (guard)');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  -- Products made in one run tie on age, so which survives falls to id order
  -- (merge_products keeps the oldest, then the lowest id). What matters is
  -- that the two are one now, and the numbers that moved say who decided.
  if (select count(distinct product_id) from public.product_part_numbers
      where number_compact = '0280158117' and brand_key in ('bosch', 'delphi')) <> 1
     or not exists (select 1 from public.product_part_numbers
                    where number_compact = '0280158117' and brand_key in ('bosch', 'delphi')
                      and basis = 'verified' and verified_by = v_admin) then
    raise exception 'FAIL 5d: the merge decision did not make one product, verified';
  end if;
  if (select status from public.product_identity_reviews where id = v_review) <> 'merged' then raise exception 'FAIL 5e: review not closed'; end if;
  if (select count(*) from public.admin_audit_log where actor_id = v_admin and subject_type = 'product_review') <> 2 then
    raise exception 'FAIL 5f: decisions were not audited';
  end if;
  if (select product_id from public.product_part_numbers where brand_key = 'brandx')
     = (select product_id from public.product_part_numbers where brand_key = 'brandy') then
    raise exception 'FAIL 5g: keep separate merged';
  end if;

  -- 6. Ambiguity that goes away closes itself; a kept-separate pair is not re-filed.
  update public.listings set brand = 'Bosch' where id = l_nobrand;
  v_run := public.grow_products();
  if (select status from public.product_identity_reviews where kind = 'brandless_number' and listing_id = l_nobrand) <> 'obsolete' then
    raise exception 'FAIL 6a: a brandless review stayed open after the brand was added';
  end if;
  if (select count(*) from public.product_identity_reviews where kind = 'unscoped_same_product' and number_compact = 'x100') <> 1 then
    raise exception 'FAIL 6b: a kept-separate link was filed again';
  end if;
  if exists (select 1 from public.product_identity_reviews where kind = 'number_across_brands' and number_compact = '0280158117' and status = 'open') then
    raise exception 'FAIL 6c: merged products were filed as ambiguous again';
  end if;

  -- 6b. What queues a run (20261020150000): a price change doesn't, a brand
  -- or number change does, and the run clears what it read.
  delete from public.product_grow_queue;
  update public.listings set price_cents = price_cents + 100 where id = l_kw;
  if exists (select 1 from public.product_grow_queue) then raise exception 'FAIL 6d: a price change queued a products run'; end if;
  update public.listings set brand = 'KW Suspensions' where id = l_kw;
  if not exists (select 1 from public.product_grow_queue where listing_id = l_kw) then
    raise exception 'FAIL 6e: a brand change was not queued';
  end if;
  v_run := public.grow_products();
  if exists (select 1 from public.product_grow_queue) then raise exception 'FAIL 6f: the run left the queue full'; end if;
  if not exists (select 1 from public.product_part_numbers where brand_key = 'kwsuspensions' and number_compact = '35220001') then
    raise exception 'FAIL 6g: an hourly run missed the changed listing';
  end if;
  -- The corrected brand leaves "kw" + 35220001 with no record: that is not
  -- two brands sharing a number.
  if exists (select 1 from public.product_identity_reviews
             where kind = 'number_across_brands' and number_compact = '35220001' and status = 'open') then
    raise exception 'FAIL 6h: a corrected brand was filed as two brands sharing a number';
  end if;

  -- 7. Nothing moved vehicle fit.
  select string_agg(format('%s|%s|%s|%s', listing_id, make_key, model_key, via), ',' order by listing_id, make_key, model_key, via)
    into v_fit_after from public.listing_vehicle_fit;
  if v_fit_after is distinct from v_fit_before then raise exception 'FAIL 7: products changed vehicle fit'; end if;

  -- 8. A purchase snapshot keeps the brand.
  v_snapshot := public.listing_commercial_snapshot(l_bosch, 30000, 1500);
  if v_snapshot -> 'part' ->> 'brand' is distinct from 'Bosch' or v_snapshot -> 'part' ->> 'part_number' is distinct from '0280-158-117' then
    raise exception 'FAIL 8: the snapshot lost the brand: %', v_snapshot -> 'part';
  end if;

  -- 9. The audit trail still takes every subject it took before, plus reviews.
  if exists (
    select 1 from unnest(array['order', 'listing', 'user', 'report', 'dispute', 'payment', 'product_review']) t(v)
    where pg_get_constraintdef((select oid from pg_constraint where conname = 'admin_audit_log_subject_type_check')) not like '%' || t.v || '%'
  ) then
    raise exception 'FAIL 9: admin_audit_log lost a subject type: %',
      pg_get_constraintdef((select oid from pg_constraint where conname = 'admin_audit_log_subject_type_check'));
  end if;

  raise notice 'all products checks passed';
end $$;

rollback;
