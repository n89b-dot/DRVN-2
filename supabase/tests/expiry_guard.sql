begin;
do $$
declare buyer uuid:=gen_random_uuid(); seller uuid:=gen_random_uuid(); listing uuid; oid uuid; r jsonb; job uuid; lease uuid;
begin
 insert into auth.users(id,email) values(buyer,'expiry-buyer@example.test'),(seller,'expiry-seller@example.test');
 insert into public.listings(seller_id,title,category,price_cents,shipping_cents,status,currency) values(seller,'Expiry guard','engine',10000,0,'active','GBP') returning id into listing;
 r:=public.purchase_begin(buyer,array[listing],'expiry:fixture'); oid:=(r->'orders'->0->>'order_id')::uuid;
 if oid is null then raise exception 'Fixture order missing'; end if;
 -- A persisted creation with no returned reference is uncertain, never unpaid.
 perform public.prepare_payment_request('expiry:request',jsonb_build_object('orderIds',jsonb_build_array(oid)));
 update public.listings set reserved_until=now()-interval '1 minute' where id=listing;
 perform public.release_expired_reservations(); perform public.release_expired_reservations();
 if (select count(*) from public.remediation_jobs where dedup_key='expiry:'||oid)<>1 then raise exception 'Expiry job not deduplicated'; end if;
 if not exists(select 1 from public.listings where id=listing and status='reserved') then raise exception 'Cron released uncertain stock'; end if;
 select id into job from public.remediation_jobs where dedup_key='expiry:'||oid;
 lease:=gen_random_uuid();
 update public.remediation_jobs set status='processing',lease_id=lease,locked_until=now()+interval '2 minutes' where id=job;
 begin
  perform public.finish_reservation_expiry(job,lease,null);
  raise exception 'Unknown creation released stock';
 exception when raise_exception then if sqlerrm not like 'Payment outcome unresolved%' then raise; end if; end;
 begin
  perform public.prepare_payment_request('expiry:different',jsonb_build_object('orderIds',jsonb_build_array(oid)));
  raise exception 'Expiry accepted new payment';
 exception when raise_exception then if sqlerrm not like 'Checkout is closing%' then raise; end if; end;
 perform public.record_payment_reference('expiry:request','pi_expiry_guard');
 begin
  perform public.finish_reservation_expiry(job,gen_random_uuid(),'pi_expiry_guard');
  raise exception 'Stale worker released stock';
 exception when raise_exception then if sqlerrm<>'Expiry lease lost' then raise; end if; end;
 begin
  perform public.finish_reservation_expiry(job,lease,'pi_wrong');
  raise exception 'Wrong intent released stock';
 exception when raise_exception then if sqlerrm<>'Expiry payment reference mismatch' then raise; end if; end;
 perform public.finish_reservation_expiry(job,lease,'pi_expiry_guard');
 if not exists(select 1 from public.listings where id=listing and status='active') then raise exception 'Confirmed cancellation did not release'; end if;
 -- A future provider creation cannot reopen the closed order.
 begin
  perform public.prepare_payment_request('expiry:reopen',jsonb_build_object('orderIds',jsonb_build_array(oid)));
  raise exception 'Closed order accepted new payment';
 exception when raise_exception then if sqlerrm not like 'Checkout is closing%' then raise; end if; end;
 -- Late capture remains compensated, even after confirmed cancellation was recorded locally.
 perform public.settle_payment_capture('pi_expiry_guard',array[oid],10000,'gbp','ch_expiry',buyer);
 if not exists(select 1 from public.refund_operations where order_id=oid and purpose='late_capture') then raise exception 'Late compensation missing'; end if;
 if not exists(select 1 from public.listings where id=listing and status='active') then raise exception 'Late capture reclaimed listing'; end if;
 if has_function_privilege('authenticated','public.finish_reservation_expiry(uuid,uuid,text)','EXECUTE') then raise exception 'Public expiry permission'; end if;
 raise notice 'expiry_guard: all checks passed';
end $$;
do $$
declare buyer uuid:=gen_random_uuid(); seller uuid:=gen_random_uuid(); listing uuid; oid uuid; r jsonb; job uuid; lease uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(buyer,'expiry-empty-buyer@example.test'),(seller,'expiry-empty-seller@example.test');
 insert into public.listings(seller_id,title,category,price_cents,status,currency) values(seller,'No provider creation','engine',1000,'active','GBP') returning id into listing;
 r:=public.purchase_begin(buyer,array[listing],'expiry:empty'); oid:=(r->'orders'->0->>'order_id')::uuid;
 update public.listings set reserved_until=now()-interval '1 minute' where id=listing;
 perform public.release_expired_reservations();
 select id into job from public.remediation_jobs where dedup_key='expiry:'||oid;
 update public.remediation_jobs set status='processing',lease_id=lease,locked_until=now()+interval '2 minutes' where id=job;
 perform public.finish_reservation_expiry(job,lease,null);
 if not exists(select 1 from public.listings where id=listing and status='active') then raise exception 'Unfunded checkout was not released'; end if;
 raise notice 'expiry_guard: all unfunded checks passed';
end $$;
rollback;
