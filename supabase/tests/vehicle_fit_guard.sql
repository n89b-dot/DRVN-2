-- The vehicle filter and "fits my garage" read listing_vehicle_fit
-- (migration 20261011100000). Transactional; disposable local database only.
--
-- marketplace_match_evidence is the definition of which part fits which car.
-- The browse functions used to run it per part; they now read rows the
-- triggers keep. This holds them to the old answer for every vehicle, year
-- and viewer over parts built to sit on each edge of the rule, then changes
-- parts, fitments and cars and checks the rows followed. It also holds the
-- table to its read rule: a private car's make and model are not readable
-- through it, and clients cannot write it.
begin;

-- The browse function as it was before 20261011100000: the definition the
-- new one must agree with.
create function pg_temp.reference_browse(
  p_query text default ''::text, p_vehicle text default ''::text, p_vyear integer default 0,
  p_ymin integer default 0, p_ymax integer default 9999, p_fit boolean default false,
  p_viewer uuid default auth.uid())
returns setof public.listings
language sql
stable
as $function$
 select l.* from public.listings l where l.status='active'
 and (p_viewer is not distinct from auth.uid() or current_user='service_role')
 and (l.seller_id not in (select public.suspended_profile_ids()) or l.seller_id=p_viewer)
 and (p_vehicle='' or exists(
   select 1 from public.catalog_makes m
   left join public.catalog_models mo on mo.make_id=m.id and mo.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}-[1-9][0-9]{0,9}$' then split_part(p_vehicle,'-',2)::bigint else 0 end
   where m.id=case when p_vehicle ~ '^[1-9][0-9]{0,9}(-[1-9][0-9]{0,9})?$' then split_part(p_vehicle,'-',1)::bigint else 0 end
   and (position('-' in p_vehicle)=0 or mo.id is not null)
   and case when coalesce((select true from public.listing_fitments f where f.listing_id=l.id and lower(f.make)=lower(m.name) limit 1),false)
     or coalesce((select lower(c.make)=lower(m.name) from public.cars c where c.id=l.source_car_id),false)
   then public.marketplace_match_evidence(l.id,m.name,mo.name,p_vyear,p_viewer) in ('seller_stated','source_model','year_needed') else false end))
 and ((p_ymin=0 and p_ymax=9999) or exists(select 1 from public.cars c where c.id=l.source_car_id and (c.is_public or c.owner_id=p_viewer) and (public.profile_is_visible(c.owner_id) or c.owner_id=p_viewer) and c.year between p_ymin and p_ymax))
 and (not p_fit or exists(select 1 from public.cars g where g.owner_id=(select p_viewer) and g.make is not null and g.model is not null
   and case when coalesce((select true from public.listing_fitments f where f.listing_id=l.id and lower(f.make)=lower(g.make) limit 1),false)
     or coalesce((select lower(c.make)=lower(g.make) from public.cars c where c.id=l.source_car_id),false)
   then public.marketplace_match_evidence(l.id,g.make,g.model,coalesce(g.year,0),p_viewer) in ('seller_stated','source_model') else false end))
 and (trim(p_query)='' or l.id in(select public.marketplace_search_ids(p_query)));
$function$;

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_suspended uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  c_public uuid := gen_random_uuid();
  c_private uuid := gen_random_uuid();
  c_no_model uuid := gen_random_uuid();
  c_suspended uuid := gen_random_uuid();
  c_cased uuid := gen_random_uuid();
  c_other uuid := gen_random_uuid();
  l uuid[] := array(select gen_random_uuid() from generate_series(1, 14));
  v_make bigint; v_alpha bigint; v_beta bigint; v_other bigint;
  v_vehicles text[];
  v_vehicle text;
  v_year int;
  v_who text;
  v_new uuid[];
  v_old uuid[];
  v_checked int := 0;
  v_count int;
  v_denied boolean;
begin

  insert into auth.users(id, email) values
    (v_seller, 'fit-seller@drvn.test'), (v_suspended, 'fit-suspended@drvn.test'), (v_viewer, 'fit-viewer@drvn.test');
  insert into public.profiles(id, username) values
    (v_seller, 'fit_seller'), (v_suspended, 'fit_suspended'), (v_viewer, 'fit_viewer')
    on conflict (id) do update set username = excluded.username;

  insert into public.catalog_makes(name) values ('Zzvmake'), ('Zzvother');
  select id into v_make from public.catalog_makes where name = 'Zzvmake';
  select id into v_other from public.catalog_makes where name = 'Zzvother';
  insert into public.catalog_models(make_id, name) values (v_make, 'Alpha'), (v_make, 'Beta');
  select id into v_alpha from public.catalog_models where make_id = v_make and name = 'Alpha';
  select id into v_beta from public.catalog_models where make_id = v_make and name = 'Beta';

  insert into public.cars(id, owner_id, slug, name, make, model, year, is_public) values
    (c_public,    v_seller,    'fit-public',    'Fit public',    'Zzvmake', 'Alpha', 2010, true),
    (c_private,   v_seller,    'fit-private',   'Fit private',   'Zzvmake', 'Beta',  2012, false),
    (c_no_model,  v_seller,    'fit-no-model',  'Fit no model',  'Zzvmake', null,    2011, true),
    (c_suspended, v_suspended, 'fit-suspended', 'Fit suspended', 'Zzvmake', 'Alpha', 2010, true),
    (c_cased,     v_seller,    'fit-cased',     'Fit cased',     'zzvMAKE', 'ALPHA', 2015, true),
    (c_other,     v_seller,    'fit-other',     'Fit other',     'Zzvother','Gamma', 2020, true);
  -- The viewer's garage: a dated car, an undated one, another make.
  insert into public.cars(owner_id, slug, name, make, model, year, is_public) values
    (v_viewer, 'fit-g1', 'Garage alpha', 'Zzvmake', 'Alpha', 2010, false),
    (v_viewer, 'fit-g2', 'Garage beta',  'Zzvmake', 'Beta',  null, true),
    (v_viewer, 'fit-g3', 'Garage gamma', 'Zzvother','Gamma', 2020, true);

  insert into public.listings(id, seller_id, source_car_id, title, category, price_cents, currency, status) values
    (l[1],  v_seller,    c_public,    'Fit 1 from the car only',            'performance', 1000, 'USD', 'active'),
    (l[2],  v_seller,    c_public,    'Fit 2 stated years exclude the car', 'performance', 1000, 'USD', 'active'),
    (l[3],  v_seller,    c_private,   'Fit 3 off a private car',            'performance', 1000, 'USD', 'active'),
    (l[4],  v_seller,    null,        'Fit 4 stated every year',            'performance', 1000, 'USD', 'active'),
    (l[5],  v_seller,    null,        'Fit 5 stated from a year',           'performance', 1000, 'USD', 'active'),
    (l[6],  v_suspended, c_suspended, 'Fit 6 suspended seller',             'performance', 1000, 'USD', 'active'),
    (l[7],  v_seller,    c_public,    'Fit 7 draft',                        'performance', 1000, 'USD', 'draft'),
    (l[8],  v_seller,    c_no_model,  'Fit 8 car with no model',            'performance', 1000, 'USD', 'active'),
    (l[9],  v_seller,    c_public,    'Fit 9 stated another make',          'performance', 1000, 'USD', 'active'),
    (l[10], v_seller,    c_public,    'Fit 10 stated another model',        'performance', 1000, 'USD', 'active'),
    (l[11], v_seller,    c_cased,     'Fit 11 car named in other case',     'performance', 1000, 'USD', 'active'),
    (l[12], v_seller,    null,        'Fit 12 two year ranges',             'performance', 1000, 'USD', 'active'),
    (l[13], v_seller,    c_other,     'Fit 13 other make car',              'performance', 1000, 'USD', 'active'),
    (l[14], v_seller,    c_public,    'Fit 14 sold',                        'performance', 1000, 'USD', 'sold');
  insert into public.listing_fitments(listing_id, make, model, year_start, year_end) values
    (l[2],  'Zzvmake',  'Alpha', 2000, 2005),
    (l[4],  'ZZVMAKE',  'beta',  null, null),
    (l[5],  'Zzvmake',  'Beta',  2011, null),
    (l[9],  'Zzvother', 'Gamma', 2018, 2022),
    (l[10], 'Zzvmake',  'Beta',  2000, 2001),
    (l[12], 'Zzvmake',  'Alpha', 2000, 2003),
    (l[12], 'Zzvmake',  'Alpha', 2008, 2012),
    (l[7],  'Zzvmake',  'Alpha', null, null);

  update public.profiles set suspended_at = now(), suspended_reason = 'guard' where id = v_suspended;

  v_vehicles := array[v_make::text, v_make || '-' || v_alpha, v_make || '-' || v_beta, v_other::text,
                      v_other || '-' || v_alpha, '999999999', 'abc', v_make || '-', '0-1'];

  -- 1. Every vehicle, year and viewer: the same parts as the evidence function.
  for pass in 1..2 loop
    foreach v_who in array array['anon', 'seller', 'viewer', 'worker'] loop
      perform set_config('role', case v_who when 'anon' then 'anon' when 'worker' then 'service_role' else 'authenticated' end, true);
      perform set_config('request.jwt.claims', case v_who
        when 'seller' then json_build_object('sub', v_seller, 'role', 'authenticated')::text
        when 'viewer' then json_build_object('sub', v_viewer, 'role', 'authenticated')::text
        else '' end, true);
      foreach v_vehicle in array v_vehicles loop
        foreach v_year in array array[0, 2003, 2010, 2011, 2020] loop
          select coalesce(array_agg(id order by id), '{}') into v_new from public.marketplace_browse_rows(
            p_vehicle => v_vehicle, p_vyear => v_year,
            p_viewer => case v_who when 'worker' then v_viewer else auth.uid() end);
          select coalesce(array_agg(id order by id), '{}') into v_old from pg_temp.reference_browse(
            p_vehicle => v_vehicle, p_vyear => v_year,
            p_viewer => case v_who when 'worker' then v_viewer else auth.uid() end);
          if v_new <> v_old then
            raise exception 'Pass %, % filtering % / %: new path % but the evidence says %', pass, v_who, v_vehicle, v_year, v_new, v_old;
          end if;
          v_checked := v_checked + 1;
        end loop;
      end loop;
      select coalesce(array_agg(id order by id), '{}') into v_new from public.marketplace_browse_rows(
        p_fit => true, p_viewer => case v_who when 'worker' then v_viewer else auth.uid() end);
      select coalesce(array_agg(id order by id), '{}') into v_old from pg_temp.reference_browse(
        p_fit => true, p_viewer => case v_who when 'worker' then v_viewer else auth.uid() end);
      if v_new <> v_old then
        raise exception 'Pass %, % fits my garage: new path % but the evidence says %', pass, v_who, v_new, v_old;
      end if;
      -- The search entry point carries the same clauses.
      select coalesce(array_agg(id order by id), '{}') into v_new from public.marketplace_search_browse_rows(
        'fit', p_vehicle => v_make || '-' || v_alpha, p_vyear => 2010,
        p_viewer => case v_who when 'worker' then v_viewer else auth.uid() end);
      select coalesce(array_agg(id order by id), '{}') into v_old from pg_temp.reference_browse(
        p_query => 'fit', p_vehicle => v_make || '-' || v_alpha, p_vyear => 2010,
        p_viewer => case v_who when 'worker' then v_viewer else auth.uid() end);
      if v_new <> v_old then
        raise exception 'Pass %, % search + vehicle: new path % but the evidence says %', pass, v_who, v_new, v_old;
      end if;
      v_checked := v_checked + 2;
    end loop;
    perform set_config('role', 'supabase_admin', true);
    perform set_config('request.jwt.claims', '', true);

    -- 2. A sanity floor, so agreement is not two empty answers.
    select count(*) into v_count from pg_temp.reference_browse(p_vehicle => v_make || '-' || v_alpha, p_vyear => 2010);
    if pass = 1 and v_count < 4 then raise exception 'The edge-case parts should match the dated Alpha filter, got %', v_count; end if;

    if pass = 1 then
      -- 3. Change things the rows depend on, then run the comparison again.
      update public.listings set status = 'paused' where id = l[1];
      update public.listings set status = 'active' where id = l[7];
      update public.listings set status = 'active' where id = l[14];
      update public.listings set price_cents = 2500 where id = l[11];
      delete from public.listing_fitments where listing_id = l[2];
      update public.listing_fitments set year_end = 2030 where listing_id = l[10];
      insert into public.listing_fitments(listing_id, make, model) values (l[13], 'Zzvmake', 'Alpha');
      update public.cars set is_public = true where id = c_private;
      update public.cars set model = 'Beta' where id = c_public;
      update public.cars set make = null where id = c_cased;
      update public.listings set source_car_id = c_public where id = l[8];
      update public.profiles set suspended_at = null where id = v_suspended;
      update public.profiles set suspended_at = now() where id = v_seller;
      update public.profiles set suspended_at = null where id = v_seller;
    end if;
  end loop;

  -- 4. The rows are exactly what a fresh computation gives.
  create temp table fit_kept on commit drop as
    select * from public.listing_vehicle_fit where listing_id = any(l);
  perform public.refresh_listing_vehicle_fit(l);
  if exists (select * from fit_kept except select * from public.listing_vehicle_fit where listing_id = any(l))
     or exists (select * from public.listing_vehicle_fit where listing_id = any(l) except select * from fit_kept) then
    raise exception 'The triggers left listing_vehicle_fit different from a fresh computation';
  end if;
  if exists (select 1 from public.listing_vehicle_fit f join public.listings p on p.id = f.listing_id
             where p.status <> 'active' or f.price_cents <> p.price_cents or f.published_at <> p.published_at or f.seller_id <> p.seller_id) then
    raise exception 'listing_vehicle_fit holds a part not for sale, or a stale price, date or seller';
  end if;
  if not exists (select 1 from public.listing_vehicle_fit where listing_id = l[11] and price_cents = 2500) and
     exists (select 1 from public.listing_vehicle_fit where listing_id = l[11]) then
    raise exception 'A price change did not reach listing_vehicle_fit';
  end if;

  -- 5. The read rule. A private car's make and model are not readable
  --    through the table except by its owner; clients cannot write it.
  update public.cars set is_public = false where id = c_public;
  perform set_config('role', 'anon', true);
  if exists (select 1 from public.listing_vehicle_fit where car_owner_id = v_seller and not car_public) then
    raise exception 'A signed-out visitor can read a private car''s make and model through listing_vehicle_fit';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.listing_vehicle_fit where car_owner_id = v_seller and not car_public) then
    raise exception 'Another member can read a private car''s make and model through listing_vehicle_fit';
  end if;
  v_denied := false;
  begin
    insert into public.listing_vehicle_fit(listing_id, make_key, model_key, via, seller_id, published_at, price_cents)
    values (l[4], 'x', 'y', 'stated', v_seller, now(), 1);
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'A member could write listing_vehicle_fit'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.listing_vehicle_fit where car_owner_id = v_seller and not car_public) then
    raise exception 'The owner should still read their own private car''s rows';
  end if;
  begin
    perform public.refresh_listing_vehicle_fit(l);
    raise exception 'A member could call refresh_listing_vehicle_fit';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'supabase_admin', true);

  -- 6. Shape: browse stays inlinable (no SET, invoker) so a page is read off an index.
  if exists (select 1 from pg_proc p where p.oid = 'public.marketplace_browse_rows(text,text,integer,integer,integer,boolean,uuid)'::regprocedure
             and (p.prosecdef or p.proconfig is not null)) then
    raise exception 'marketplace_browse_rows must stay SECURITY INVOKER with no SET clause';
  end if;

  raise notice 'all vehicle fit checks passed (% comparisons)', v_checked;
end $$;

rollback;
