begin;
do $$
declare buyer uuid:=gen_random_uuid(); seller uuid:=gen_random_uuid(); listing uuid; oid uuid; r jsonb; version uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(buyer,'consent-buyer@example.test'),(seller,'consent-seller@example.test');
 insert into public.listings(seller_id,title,category,price_cents,status,currency) values(seller,'Consent purchase','engine',1000,'active','USD') returning id into listing;
 r:=public.purchase_begin(buyer,array[listing],'consent:purchase');oid:=(r->'orders'->0->>'order_id')::uuid;
 insert into public.analytics_consents(user_id,allowed,version) values(buyer,true,version);
 update public.orders set analytics_consent_version=version where id=oid;
 perform public.purchase_finalize(oid,true,'stub','stub_consent',null);
 perform public.purchase_finalize(oid,true,'stub','stub_consent',null);
 if (select count(*) from public.remediation_jobs where dedup_key='purchase:'||oid)<>1 then raise exception 'Duplicate analytics purchase'; end if;
 if exists(select 1 from public.remediation_jobs where dedup_key='purchase:'||oid and (payload ? 'address' or payload ? 'payment_reference')) then raise exception 'Sensitive analytics payload'; end if;
 if has_function_privilege('anon','public.set_analytics_consent(boolean)','EXECUTE') then raise exception 'Anonymous consent mutation'; end if;
 raise notice 'consent_guard: all checks passed';
end $$;
rollback;
