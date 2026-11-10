-- Isolated database only. Fixtures, role changes and mutations roll back.
begin;
create function pg_temp.marketplace_role(uid uuid) returns void language sql as $$
  select set_config('role', case when uid is null then 'anon' else 'authenticated' end, true);
  select set_config('request.jwt.claims', json_build_object('sub',uid,'role',case when uid is null then 'anon' else 'authenticated' end)::text, true);
$$;
create function pg_temp.marketplace_admin() returns void language sql as $$
  select set_config('role','none',true);
  select set_config('request.jwt.claims','',true);
$$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (20261110170000), so they are opened here.
grant execute on all routines in schema pg_temp to public;
do $$
declare seller uuid:=gen_random_uuid(); buyer uuid:=gen_random_uuid(); car uuid; part uuid; n int;
begin
  insert into auth.users(id,email) values(seller,'marketplace-guard-seller@example.test'),(buyer,'marketplace-guard-buyer@example.test');
  insert into public.cars(owner_id,name,slug,make,model,year,is_public)
  values(seller,'Marketplace fixture','marketplace-guard-'||seller,'Volkswagen','Golf',2018,true) returning id into car;
  insert into public.listings(seller_id,title,category,subcategory,price_cents,status,currency,part_number,source_car_id)
  values(seller,'MarketplaceGuard Coilover','brakes-suspension','coilovers',50000,'active','USD','06K-145-874-F',car) returning id into part;

  begin
    update public.listings set subcategory='seats' where id=part;
    raise exception 'Mismatched category/part type was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.listings set category='invented-category' where id=part;
    raise exception 'Unknown category was accepted';
  exception when check_violation then null;
  end;

  perform pg_temp.marketplace_role(null);
  select count(*) into n from public.marketplace_filtered_rows() where id=part;
  if n<>1 then raise exception 'Anonymous browse lost visible inventory'; end if;
  select count(*) into n from public.marketplace_filtered_rows(p_query=>'06k145874f') where id=part;
  if n<>1 then raise exception 'Compact part number failed'; end if;
  select count(*) into n from public.marketplace_filtered_rows(p_query=>'MarketplaceGuard',p_make=>'Volkswagen',p_model=>'Golf',p_ymin=>2018,p_ymax=>2018) where id=part;
  if n<>1 then raise exception 'Combined keyword/vehicle/year failed'; end if;
  select count(*) into n from public.marketplace_filtered_rows(p_query=>'MarketplaceGuard') where id=part and price_cents<40000;
  if n<>0 then raise exception 'Price filtering did not constrain results'; end if;

  perform pg_temp.marketplace_admin();
  update public.cars set is_public=false where id=car;
  perform pg_temp.marketplace_role(buyer);
  select count(*) into n from public.cars where id=car;
  if n<>0 then raise exception 'Buyer can see private source build'; end if;
  select count(*) into n from public.marketplace_filtered_rows() where id=part;
  if n<>1 then raise exception 'Private provenance incorrectly hid public listing'; end if;

  perform pg_temp.marketplace_admin();
  update public.profiles set suspended_at=now() where id=seller;
  perform pg_temp.marketplace_role(null);
  select count(*) into n from public.marketplace_filtered_rows() where id=part;
  if n<>0 then raise exception 'Suspended listing visible to guest'; end if;
  perform pg_temp.marketplace_role(buyer);
  select count(*) into n from public.marketplace_filtered_rows(p_query=>'06k145874f') where id=part;
  if n<>0 then raise exception 'Identifier search bypassed suspension'; end if;
  perform pg_temp.marketplace_role(seller);
  select count(*) into n from public.marketplace_filtered_rows() where id=part;
  if n<>1 then raise exception 'Owner lost their own listing'; end if;
  select count(*) into n from public.cars where id=car;
  if n<>1 then raise exception 'Owner lost their private build'; end if;
  perform pg_temp.marketplace_admin();
  raise notice 'marketplace_retrieval_guard: all checks passed';
end $$;
rollback;
