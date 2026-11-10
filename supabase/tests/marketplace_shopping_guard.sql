begin;
create function pg_temp.role_for(uid uuid, service boolean default false) returns void language sql as $$
 select set_config('role',case when service then 'service_role' when uid is null then 'anon' else 'authenticated' end,true);
 select set_config('request.jwt.claims',json_build_object('sub',uid,'role',case when service then 'service_role' when uid is null then 'anon' else 'authenticated' end)::text,true);
$$;
create function pg_temp.admin_role() returns void language sql as $$ select set_config('role','none',true); select set_config('request.jwt.claims','',true); $$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (architecture plan 2, item A3), so they are opened here.
grant execute on all routines in schema pg_temp to public;
do $$
declare seller uuid:=gen_random_uuid(); buyer uuid:=gen_random_uuid(); car uuid; part uuid; garage uuid; n int; evidence text; saved uuid; saved_again uuid; fixture_make bigint; fixture_model bigint; vehicle_param text;
begin
 insert into public.catalog_makes(name) values('Volkswagen') on conflict(lower(name)) do update set name=excluded.name returning id into fixture_make;
 insert into public.catalog_models(make_id,name) values(fixture_make,'Golf') on conflict(make_id,lower(name)) do update set name=excluded.name returning id into fixture_model;
 vehicle_param:=fixture_make||'-'||fixture_model;
 insert into auth.users(id,email) values(seller,'shopping-seller@example.test'),(buyer,'shopping-buyer@example.test');
 insert into public.cars(owner_id,name,slug,make,model,year,is_public) values(seller,'Source','shopping-source-'||seller,'Volkswagen','Golf',2018,true) returning id into car;
 insert into public.cars(owner_id,name,slug,make,model,year,is_public) values(buyer,'Garage','shopping-garage-'||buyer,'Volkswagen','Golf',null,false) returning id into garage;
 insert into public.listings(seller_id,title,category,subcategory,price_cents,status,currency,part_number,source_car_id) values(seller,'ShoppingGuard Turbo','performance','turbo',50000,'active','USD','06K-145-874-F',car) returning id into part;
 insert into public.listing_fitments(listing_id,make,model,year_start,year_end) values(part,'Volkswagen','Golf',2017,2020);
 perform pg_temp.role_for(null);
 select public.marketplace_match_evidence(part,'Volkswagen','Golf',0) into evidence;
 if evidence<>'year_needed' then raise exception 'Unknown year incorrectly matched: %',evidence; end if;
 if public.marketplace_match_evidence(part,'Volkswagen','Golf',2018)<>'seller_stated' then raise exception 'Bounded year failed'; end if;
 if public.marketplace_match_evidence(part,'Volkswagen','Golf',2022)<>'outside_years' then raise exception 'Source model overrode incompatible years'; end if;
 select count(*) into n from public.marketplace_browse_rows(p_query=>'06k145874f') where id=part;
 if n<>1 then raise exception 'Compact identity failed'; end if;
 select count(*) into n from public.marketplace_browse_rows(p_vehicle=>vehicle_param,p_vyear=>2018) where id=part;
 if n<>1 then raise exception 'Selected catalog vehicle/year failed'; end if;
 select count(*) into n from public.marketplace_browse_rows(p_vehicle=>vehicle_param,p_vyear=>2022) where id=part;
 if n<>0 then raise exception 'Selected incompatible year was included'; end if;
 select count(*) into n from public.marketplace_browse_rows(p_viewer=>buyer) where id=part;
 if n<>0 then raise exception 'Guest impersonated garage owner'; end if;
 perform pg_temp.role_for(buyer);
 select count(*) into n from public.marketplace_browse_rows(p_fit=>true) where id=part;
 if n<>0 then raise exception 'Unknown garage year counted as a fit'; end if;
 saved:=public.save_marketplace_search('Test','{"q":"ShoppingGuard","_version":"2"}');
 saved_again:=public.save_marketplace_search('Test again','{"_version":"2","q":"ShoppingGuard"}');
 if saved<>saved_again then raise exception 'Duplicate saved search'; end if;
 if (select alert from public.saved_searches where id=saved) then raise exception 'Save opted into alerts'; end if;
 perform pg_temp.admin_role();
 update public.cars set year=2018 where id=garage;
 perform pg_temp.role_for(buyer);
 select count(*) into n from public.marketplace_browse_rows(p_fit=>true) where id=part;
 if n<>1 then raise exception 'Known garage year lost match'; end if;
 perform pg_temp.admin_role();
 delete from public.listing_fitments where listing_id=part;
 update public.cars set is_public=false where id=car;
 perform pg_temp.role_for(null,true);
 if public.marketplace_match_evidence(part,'Volkswagen','Golf',2018,buyer)<>'unknown' then raise exception 'Worker used private source as evidence'; end if;
 select count(*) into n from public.marketplace_browse_rows(p_fit=>true,p_viewer=>buyer) where id=part;
 if n<>0 then raise exception 'Worker garage matching bypassed source privacy'; end if;
 perform pg_temp.admin_role();
 update public.profiles set suspended_at=now() where id=seller;
 perform pg_temp.role_for(null,true);
 select count(*) into n from public.marketplace_browse_rows(p_query=>'ShoppingGuard',p_viewer=>buyer) where id=part;
 if n<>0 then raise exception 'Worker included suspended seller'; end if;
 perform pg_temp.admin_role();
 raise notice 'marketplace_shopping_guard: all checks passed';
end $$;
rollback;
