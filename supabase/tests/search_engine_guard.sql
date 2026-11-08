-- Text search at millions of parts (migration 20261011130000). Transactional;
-- disposable local database only.
--
-- Holds: the capped Postgres search to "the newest 1,001 parts the old
-- search finds, within the filters", and to the visitor's read rule (it is
-- SECURITY DEFINER); the engine's page re-check to its order and the rules;
-- typo correction to the word list of parts for sale; the document builder
-- to what may be searchable; and the search queue to
-- fields the documents hold — a counted view queues nothing, an edit to a
-- part, a suspension and a car's visibility do.
begin;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_suspended uuid := gen_random_uuid();
  v_car uuid := gen_random_uuid();
  v_private_car uuid := gen_random_uuid();
  parts uuid[] := array(select gen_random_uuid() from generate_series(1, 30));
  v_draft uuid := gen_random_uuid();
  v_hidden uuid := gen_random_uuid();
  v_ids uuid[];
  v_ref uuid[];
  v_doc jsonb;
  v_jobs int;
  v_denied boolean;
  stamp timestamptz := now() - interval '2 days';
begin
  insert into auth.users(id, email) values (v_seller, 'engine-seller@drvn.test'), (v_suspended, 'engine-suspended@drvn.test');
  insert into public.profiles(id, username) values (v_seller, 'engine_seller'), (v_suspended, 'engine_suspended')
    on conflict (id) do update set username = excluded.username;
  insert into public.cars(id, owner_id, slug, name, make, model, year, is_public) values
    (v_car, v_seller, 'engine-public', 'Engine public', 'Zzemake', 'Zzemodel', 2012, true),
    (v_private_car, v_seller, 'engine-private', 'Engine private', 'Zzesecret', 'Zzehidden', 2014, false);
  -- Thirty parts with "zzengine" in the title, a minute apart, every third
  -- in "engine", every fifth a Zzebrand; plus a draft and a suspended
  -- seller's part that match too.
  insert into public.listings(id, seller_id, source_car_id, title, category, price_cents, currency, status, brand, part_number, created_at)
  select parts[n], v_seller, case when n % 2 = 0 then v_car else v_private_car end, 'Zzengine part ' || n,
         case when n % 3 = 0 then 'engine' else 'performance' end, 1000 + n, 'USD', 'active',
         case when n % 5 = 0 then 'Zzebrand' else 'Other' end, 'ZE-' || (77000 + n), stamp + n * interval '1 minute'
  from generate_series(1, 30) n;
  insert into public.listings(id, seller_id, title, category, price_cents, currency, status, created_at) values
    (v_draft, v_seller, 'Zzengine zzdraftword', 'engine', 1000, 'USD', 'draft', stamp + interval '1 hour'),
    (v_hidden, v_suspended, 'Zzengine zzhiddenword', 'engine', 1000, 'USD', 'active', stamp + interval '1 hour');
  insert into public.listing_fitments(listing_id, make, model, year_start, year_end) values (parts[2], 'Zzemake', 'Zzemodel', 2010, 2011);
  update public.profiles set suspended_at = now(), suspended_reason = 'guard' where id = v_suspended;

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);

  -- 1. The cap: the newest p_cap of what the old search finds, filters first.
  v_ref := array(select l.id from public.marketplace_search_ids('zzengine') s(id) join public.listings l on l.id = s.id
                 order by l.created_at desc, l.id desc);
  if cardinality(v_ref) <> 30 then raise exception 'The old search should find the 30 guard parts, found %', cardinality(v_ref); end if;
  v_ids := array(select l.id from public.marketplace_search_capped_ids('zzengine', p_cap => 7) s(id)
                 join public.listings l on l.id = s.id order by l.created_at desc, l.id desc);
  if v_ids <> v_ref[1:7] then raise exception 'Capped search is not the newest seven matches: %', v_ids; end if;
  v_ids := array(select l.id from public.marketplace_search_capped_ids('zzengine', p_category => 'engine', p_cap => 4) s(id)
                 join public.listings l on l.id = s.id order by l.created_at desc, l.id desc);
  v_ref := array(select x from unnest(v_ref) x join public.listings l on l.id = x where l.category = 'engine' order by l.created_at desc, l.id desc limit 4);
  if v_ids <> v_ref then raise exception 'Capped search must filter before it caps: % vs %', v_ids, v_ref; end if;
  if (select count(*) from public.marketplace_search_capped_ids('zzengine', p_brand => 'zzebrand')) <> 6 then
    raise exception 'Capped search with a brand should find the six Zzebrand parts';
  end if;
  -- A part number is matched by its numbers only.
  if array(select * from public.marketplace_search_capped_ids('ZE-77004')) <> array[parts[4]] then
    raise exception 'A part number should find exactly its part';
  end if;
  -- Never a draft or a suspended seller's part, though both match.
  if exists (select 1 from public.marketplace_search_capped_ids('zzengine', p_cap => 100) s(id) where s.id in (v_draft, v_hidden)) then
    raise exception 'Capped search returned a draft or a suspended seller''s part';
  end if;
  -- Quotes in the words or filters can't change the query.
  perform public.marketplace_search_capped_ids($q$zz' or 1=1 --$q$, p_brand => $q$x' or 'a'='a$q$, p_location => $q$') or (true$q$);
  if exists (select 1 from public.marketplace_search_capped_ids('zzengine', p_brand => $q$x' or 'a'='a$q$)) then
    raise exception 'A quote in a filter changed the capped search';
  end if;

  -- 1b. Typos: a word not on the list is searched with its closest word.
  perform set_config('role', 'supabase_admin', true);
  perform public.refresh_search_words();
  if not exists (select 1 from public.search_words where word = 'zzengine') then
    raise exception 'The word list is missing a word of a part for sale';
  end if;
  if exists (select 1 from public.search_words where word in ('zzdraftword', 'zzhiddenword')) then
    raise exception 'The word list holds a word only a draft or a suspended seller''s part has';
  end if;
  perform set_config('role', 'anon', true);
  if array(select correction from public.search_word_corrections('Zzengnie kit')) <> array['zzengine'] then
    raise exception 'A misspelt word should be corrected to the closest listed word: %', array(select correction from public.search_word_corrections('Zzengnie kit'));
  end if;
  if exists (select 1 from public.search_word_corrections('zzengine ZE-77004 kit')) then
    raise exception 'A listed word, a part number or a short word should not be corrected';
  end if;
  if exists (select 1 from public.search_word_corrections('zzhiddenwrd zzdraftwrd') where correction in ('zzhiddenword', 'zzdraftword')) then
    raise exception 'A correction revealed a word only a draft or a suspended seller''s part has';
  end if;
  if (select count(*) from public.marketplace_search_capped_ids('zzengnie', p_cap => 100)) <> 30 then
    raise exception 'A misspelt search should find what the corrected word finds';
  end if;
  v_denied := false;
  begin perform 1 from public.search_words limit 1;
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'A visitor could read the word list directly'; end if;
  v_denied := false;
  begin perform public.refresh_search_words();
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'A visitor could refresh the word list'; end if;

  -- 2. The engine's page, re-checked: its order kept, ineligible ids dropped.
  v_ids := array(select id from public.marketplace_page(p_ids => array[parts[3], v_draft, parts[9], v_hidden, parts[1]]));
  if v_ids <> array[parts[3], parts[9], parts[1]] then
    raise exception 'The engine page re-check should keep its order and drop a draft and a suspended part: %', v_ids;
  end if;
  if public.marketplace_count(p_ids => array[parts[3], v_draft, parts[9]], p_category => 'engine') <> 2 then
    raise exception 'The engine page re-check should apply the filters too';
  end if;

  -- 3. Documents: service only; only what may be found; no private car names.
  v_denied := false;
  begin perform public.search_listing_documents(parts);
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'A visitor could build search documents'; end if;
  perform set_config('role', 'service_role', true);
  if exists (select 1 from public.search_listing_documents(array[v_draft, v_hidden])) then
    raise exception 'search_listing_documents built a document for a draft or a suspended seller''s part';
  end if;
  select doc into v_doc from public.search_listing_documents(array[parts[1]]);
  if v_doc->>'source_car' <> '' or v_doc::text like '%zzesecret%' then
    raise exception 'A private car''s make and model reached a search document: %', v_doc;
  end if;
  select doc into v_doc from public.search_listing_documents(array[parts[2]]);
  if not (v_doc->'fit_keys' ? 'zzemake|zzemodel' and v_doc->'fit_year_keys' ? 'zzemake|zzemodel|2011'
          and not v_doc->'fit_year_keys' ? 'zzemake|zzemodel|2012' and v_doc->'fit_any_year' = '[]'::jsonb) then
    raise exception 'The document''s fit fields do not follow the vehicle rule: %', v_doc;
  end if;
  select doc into v_doc from public.search_listing_documents(array[parts[4]]);
  if not (v_doc->'fit_any_year' ? 'zzemake|zzemodel' and v_doc->>'source_car' like '%Zzemake%') then
    raise exception 'A part off a public car should fit it in any year: %', v_doc;
  end if;
  perform set_config('role', 'supabase_admin', true);

  -- 4. The queue follows the documents' fields.
  delete from public.remediation_jobs where kind = 'search';
  update public.listings set view_count = coalesce(view_count, 0) + 1 where id = parts[5];
  select count(*) into v_jobs from public.remediation_jobs where kind = 'search';
  if v_jobs <> 0 then raise exception 'A counted view queued % search jobs', v_jobs; end if;
  update public.profiles set notification_prefs = coalesce(notification_prefs, '{}'::jsonb) || '{"guard": true}' where id = v_seller;
  select count(*) into v_jobs from public.remediation_jobs where kind = 'search';
  if v_jobs <> 0 then raise exception 'A notification setting queued % search jobs', v_jobs; end if;
  update public.listings set title = 'Zzengine part five, edited' where id = parts[5];
  if not exists (select 1 from public.remediation_jobs where kind = 'search' and payload->>'id' = parts[5]::text) then
    raise exception 'A title edit did not queue the part';
  end if;
  update public.cars set is_public = false where id = v_car;
  if not exists (select 1 from public.remediation_jobs where kind = 'search' and payload->>'entity' = 'listing' and payload->>'id' = parts[4]::text) then
    raise exception 'A car going private did not queue the parts that came off it';
  end if;
  delete from public.remediation_jobs where kind = 'search';
  update public.profiles set suspended_at = now() where id = v_seller;
  if (select count(*) from public.remediation_jobs where kind = 'search' and payload->>'entity' = 'listing') < 30 then
    raise exception 'Suspending a seller did not queue their parts';
  end if;

  -- 5. Batched claims: one job per document, its duplicates with it.
  delete from public.remediation_jobs where kind = 'search';
  perform public.enqueue_search_document('listing', parts[1]);
  perform public.enqueue_search_document('listing', parts[2]);
  insert into public.remediation_jobs(kind, dedup_key, payload)
  values ('search', 'search:guard:dup', jsonb_build_object('entity', 'listing', 'id', parts[1]));
  v_doc := public.claim_search_job_batch(1);
  if (select count(distinct j->'payload'->>'id') from jsonb_array_elements(v_doc) j) <> 1
     or jsonb_array_length(v_doc) <> (case when v_doc->0->'payload'->>'id' = parts[1]::text then 2 else 1 end) then
    raise exception 'Claiming one document should claim every queued job for it, and only it: %', v_doc;
  end if;
  v_jobs := jsonb_array_length(v_doc) + jsonb_array_length(public.claim_search_job_batch(10));
  if v_jobs <> 3 then
    raise exception 'The two claims should take all three jobs, took %', v_jobs;
  end if;
  perform set_config('role', 'anon', true);
  v_denied := false;
  begin perform public.claim_search_job_batch(10);
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'A visitor could claim search jobs'; end if;
  perform set_config('role', 'supabase_admin', true);

  raise notice 'all search engine checks passed';
end $$;

rollback;
