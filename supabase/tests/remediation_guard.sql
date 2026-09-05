-- Disposable database only; all fixtures roll back.
begin;
do $guard$
declare buyer uuid:=gen_random_uuid(); seller uuid:=gen_random_uuid(); other_buyer uuid:=gen_random_uuid(); listing uuid; first_order uuid; late_order uuid; result jsonb; op uuid; n int; seller2 uuid:=gen_random_uuid(); l2 uuid; l3 uuid; basket_ids uuid[]; lease uuid; reclaimed uuid; replacement_order uuid;
begin
 insert into auth.users(id,email) values(buyer,'remediation-buyer@example.test'),(seller,'remediation-seller@example.test'),(other_buyer,'remediation-other@example.test');
 insert into public.listings(seller_id,title,category,price_cents,shipping_cents,status,currency) values(seller,'Settlement regression','engine',10000,1000,'active','GBP') returning id into listing;
 begin
  perform public.purchase_begin(buyer,array_fill(listing,array[51]),'remediation:oversize');
  raise exception 'Oversized checkout accepted';
 exception when raise_exception then
  if sqlerrm not like '%at most 50%' then raise; end if;
 end;
 result:=public.purchase_begin(buyer,array[listing],'remediation:first');
 first_order:=(result->'orders'->0->>'order_id')::uuid;
 if first_order is null then raise exception 'No reservation'; end if;
 if public.purchase_begin(buyer,array[listing],'remediation:first') <> result then raise exception 'Retry changed reservation'; end if;
 begin
  perform public.purchase_begin(other_buyer,array[listing],'remediation:first');
  raise exception 'Cross-buyer key accepted';
 exception when insufficient_privilege then null; end;
 perform public.prepare_payment_request('reference-regression',jsonb_build_object('orderIds',jsonb_build_array(first_order)));
 perform public.record_payment_reference('reference-regression','pi_remediation_first');
 if not exists(select 1 from public.payments where order_id=first_order and provider_reference='pi_remediation_first') then raise exception 'Persisted reference missing from order ledger'; end if;
 execute $create$create function pg_temp.reject_payout() returns trigger language plpgsql as $body$ begin raise exception 'Injected payout write failure'; end; $body$$create$;
 create trigger reject_payout before insert on public.transfer_intents for each row execute function pg_temp.reject_payout();
 begin
  perform public.settle_payment_capture('pi_remediation_first',array[first_order],11000,'gbp','ch_first',buyer);
  raise exception 'Capture ignored payout write failure';
 exception when raise_exception then
  if sqlerrm<>'Injected payout write failure' then raise; end if;
 end;
 if not exists(select 1 from public.orders where id=first_order and status='pending') or not exists(select 1 from public.payments where order_id=first_order and status='pending') then raise exception 'Failed payout left partial capture'; end if;
 drop trigger reject_payout on public.transfer_intents;
 perform public.settle_payment_capture('pi_remediation_first',array[first_order],11000,'gbp','ch_first',buyer);
 perform public.settle_payment_capture('pi_remediation_first',array[first_order],11000,'gbp','ch_first',buyer);
 select count(*) into n from public.transfer_intents where order_id=first_order;
 if n<>1 then raise exception 'Expected exactly one payout, got %',n; end if;
 update public.orders set transfer_reference='tr_existing' where id=first_order;
 perform public.settle_payment_capture('pi_remediation_first',array[first_order],11000,'gbp','ch_first',buyer);
 begin
  perform public.settle_payment_capture('pi_wrong',array[first_order],11001,'gbp','ch_first',buyer);
  raise exception 'Amount mismatch accepted';
 exception when raise_exception then
  if sqlerrm='Amount mismatch accepted' then raise; end if;
 end;
 insert into public.listings(seller_id,title,category,price_cents,shipping_cents,status,currency) values(seller,'Late capture regression','engine',20000,1000,'active','GBP') returning id into listing;
 result:=public.purchase_begin(buyer,array[listing],'remediation:late');
 late_order:=(result->'orders'->0->>'order_id')::uuid;
 perform public.purchase_finalize(late_order,false,'stripe',null,'expired');
 result:=public.purchase_begin(other_buyer,array[listing],'remediation:replacement');
 replacement_order:=(result->'orders'->0->>'order_id')::uuid;
 perform public.settle_payment_capture('pi_replacement',array[replacement_order],21000,'GBP','ch_replacement',other_buyer);
 result:=public.settle_payment_capture('pi_remediation_late',array[late_order],21000,'gbp','ch_late',buyer);
 if result->>'outcome'<>'compensation_queued' then raise exception 'Late capture not compensated'; end if;
 perform public.settle_payment_capture('pi_remediation_late',array[late_order],21000,'gbp','ch_late',buyer);
 select id into strict op from public.refund_operations where order_id=late_order and purpose='late_capture';
 update public.refund_operations set status='provider_succeeded',refund_reference='re_late' where id=op;
 perform public.settle_refund_operation(op);
 if exists(select 1 from public.orders where id=late_order and status not in ('cancelled','payment_failed')) then raise exception 'Refund revived fulfillment'; end if;
 if exists(select 1 from public.transfer_intents where order_id=late_order) then raise exception 'Late capture created payout'; end if;
 if not exists(select 1 from public.listings where id=listing and status='sold') or not exists(select 1 from public.orders where id=replacement_order and buyer_id=other_buyer and status='paid') then raise exception 'Late capture disturbed replacement buyer'; end if;
 insert into auth.users(id,email) values(seller2,'remediation-second-seller@example.test');
 insert into public.listings(seller_id,title,category,price_cents,shipping_cents,status,currency) values(seller,'Basket one','engine',5000,0,'active','GBP') returning id into l2;
 insert into public.listings(seller_id,title,category,price_cents,shipping_cents,status,currency) values(seller2,'Basket two','engine',5000,0,'active','GBP') returning id into l3;
 result:=public.purchase_begin(buyer,array[l2,l3],'remediation:basket');
 select array_agg((entry->>'order_id')::uuid) into basket_ids from jsonb_array_elements(result->'orders') entry;
 perform public.settle_payment_capture('pi_shared_basket',basket_ids,10000,'GBP','ch_basket',buyer);
 perform public.settle_payment_capture('pi_shared_basket',basket_ids,10000,'GBP','ch_basket',buyer);
 select count(*) into n from public.payments where provider_reference='pi_shared_basket';
 if n<>2 then raise exception 'Multi-seller payment mapping lost an order'; end if;
 select count(*) into n from public.transfer_intents where order_id=any(basket_ids);
 if n<>2 then raise exception 'Multi-seller payout obligations not exactly once'; end if;
 insert into public.remediation_jobs(kind,dedup_key,payload,next_attempt_at)
 values('receipt','lease-regression:'||gen_random_uuid(),jsonb_build_object('buyer_id',buyer),now()-interval '1 day') returning id into op;
 result:=public.claim_remediation_jobs('receipt',1);
 lease:=(result->0->>'lease_id')::uuid;
 if (result->0->>'id')::uuid<>op then raise exception 'Lease fixture was not claimed'; end if;
 update public.remediation_jobs set locked_until=now()-interval '1 second' where id=op;
 result:=public.claim_remediation_jobs('receipt',1);
 reclaimed:=(result->0->>'lease_id')::uuid;
 if reclaimed is null or reclaimed=lease then raise exception 'Expired lease not reclaimed'; end if;
 begin
  perform public.finish_remediation_job(op,lease);
  raise exception 'Stale worker acknowledged reclaimed job';
 exception when raise_exception then
  if sqlerrm<>'Job lease lost' then raise; end if;
 end;
 perform public.finish_remediation_job(op,reclaimed);
 update public.remediation_jobs set status='processing',attempts=10,locked_until=now()-interval '1 second' where id=op;
 perform public.claim_remediation_jobs('receipt',1);
 if not exists(select 1 from public.remediation_jobs where id=op and status='failed') then raise exception 'Exhausted job silently stranded'; end if;
 if not exists(select 1 from jsonb_array_elements(public.worker_health_snapshot()->'queues') q where q->>'kind'='receipt' and q->>'status'='failed') then raise exception 'Failed queue missing from health'; end if;
 raise notice 'all remediation checks passed';
end $guard$;
rollback;
