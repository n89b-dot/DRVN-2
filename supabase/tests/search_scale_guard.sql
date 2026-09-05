begin;
do $$
declare seller uuid:=gen_random_uuid(); n int;
begin
 insert into auth.users(id,email) values(seller,'search-scale@example.test');
 insert into public.listings(seller_id,title,category,price_cents,status,currency)
 select seller,'ScaleGuardRotor '||i,'engine',i*100,'active','GBP' from generate_series(1,450) i;
 select count(*) into n from public.marketplace_search_rows('ScaleGuardRotor') where seller_id=seller;
 if n<>450 then raise exception 'Canonical search truncated: %',n; end if;
 select count(*) into n from public.marketplace_search_rows('ScaleGuardRotor') where seller_id=seller and price_cents>44000;
 if n<>10 then raise exception 'Filtering happened after search cap'; end if;
 raise notice 'search_scale_guard: all checks passed';
end $$;
rollback;
