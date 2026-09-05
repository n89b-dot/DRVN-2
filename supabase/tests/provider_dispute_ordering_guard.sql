begin;
do $$
declare seller uuid:=gen_random_uuid(); buyer uuid:=gen_random_uuid(); oid uuid; second uuid;
 lease uuid:=gen_random_uuid(); next_lease uuid:=gen_random_uuid(); result text; rejected boolean:=false;
begin
 insert into auth.users(id,email) values(seller,'dispute-seller@drvn.test'),(buyer,'dispute-buyer@drvn.test');
 insert into public.orders(buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency)
 values(buyer,seller,'paid',10000,1000,10000,'USD') returning id into oid;
 insert into public.payments(order_id,provider,provider_reference,status,amount_cents,currency)
 values(oid,'stripe','pi_dispute_ordering','succeeded',10000,'USD');
 result:=public.apply_stripe_dispute_event('dp_closed_first','pi_dispute_ordering',10000,'usd','won',true,'evt_close_first',110,lease);
 if result<>'committed' then raise exception 'Closed-first not committed'; end if;
 perform public.apply_stripe_dispute_event('dp_closed_first','pi_dispute_ordering',10000,'usd','needs_response',false,'evt_old_create',100,lease);
 if (select status from public.orders where id=oid)<>'paid' then raise exception 'Old create reopened closed dispute'; end if;
 raise notice 'PASS 1: closed-before-created remains terminal';
 update public.orders set dispute_resolved_at=now() where id=oid;
 result:=public.apply_stripe_dispute_event('dp_new','pi_dispute_ordering',10000,'usd','needs_response',false,'evt_new_create',200,lease);
 if result<>'committed' or not exists(select 1 from public.orders where id=oid and status='disputed' and dispute_resolved_at is null) then raise exception 'New dispute did not reopen old app resolution'; end if;
 perform public.apply_stripe_dispute_event('dp_new','pi_dispute_ordering',10000,'usd','won',true,'evt_new_won',210,lease);
 perform public.apply_stripe_dispute_event('dp_new','pi_dispute_ordering',10000,'usd','needs_response',false,'evt_new_create',200,lease);
 if (select status from public.orders where id=oid)<>'paid' then raise exception 'Replay reopened won dispute'; end if;
 raise notice 'PASS 2: new provider identity opens, won restores, replay stays closed';
 perform public.apply_stripe_dispute_event('dp_warning','pi_dispute_ordering',10000,'usd','warning_needs_response',false,'evt_warning',220,lease);
 perform public.apply_stripe_dispute_event('dp_warning','pi_dispute_ordering',10000,'usd','warning_closed',true,'evt_warning_closed',230,lease);
 if (select status from public.orders where id=oid)<>'paid' then raise exception 'Closed warning left an order frozen'; end if;
 raise notice 'PASS: warning closure restores only its own hold';
 result:=public.apply_stripe_dispute_event('dp_partial','pi_dispute_ordering',4000,'usd','lost',true,'evt_partial_loss',300,lease);
 if result<>'recovery_recorded' or (select refunded_cents from public.orders where id=oid)<>0 then raise exception 'Partial dispute refunded full order'; end if;
 perform public.apply_stripe_dispute_event('dp_partial','pi_dispute_ordering',4000,'usd','lost',true,'evt_partial_loss',300,lease);
 if (select count(*) from public.payment_recoveries where recovery_key='stripe:dispute:dp_partial')<>1 or (select count(*) from public.admin_alert_outbox where dedup_key='stripe-dispute:dp_partial')<>1 then raise exception 'Recovery or alert duplicated'; end if;
 raise notice 'PASS 3: partial chargeback freezes and alerts once without refunding';
 result:=public.apply_stripe_dispute_event('dp_unknown','pi_missing',10000,'usd','lost',true,'evt_missing',400,lease);
 if result<>'retry' then raise exception 'Unknown mapping acknowledged'; end if;
 raise notice 'PASS 4: unknown intent stays retryable';
 -- A separate complete basket permits loss booking; its lease must be live.
 insert into public.orders(buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency)
 values(buyer,seller,'paid',6000,600,6000,'USD') returning id into oid;
 insert into public.orders(buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency)
 values(buyer,seller,'paid',4000,400,4000,'USD') returning id into second;
 insert into public.payments(order_id,provider,provider_reference,status,amount_cents,currency)
 values(oid,'stripe','pi_basket_dispute','succeeded',6000,'USD'),(second,'stripe','pi_basket_dispute','succeeded',4000,'USD');
 perform public.apply_stripe_dispute_event('dp_basket_won','pi_basket_dispute',10000,'usd','needs_response',false,'evt_basket_open',450,lease);
 perform public.apply_stripe_dispute_event('dp_basket_won','pi_basket_dispute',10000,'usd','won',true,'evt_basket_won',460,lease);
 if (select count(*) from public.orders where id in (oid,second) and status='paid')<>2 then raise exception 'Won basket not restored atomically'; end if;
 result:=public.apply_stripe_dispute_event('dp_basket','pi_basket_dispute',10000,'usd','lost',true,'evt_basket_loss',500,lease);
 if result<>'apply_loss' or (select count(*) from public.orders where id in (oid,second) and status='disputed')<>2 then raise exception 'Complete basket not held atomically'; end if;
 if public.apply_stripe_dispute_event('dp_basket','pi_basket_dispute',10000,'usd','lost',true,'evt_basket_loss',500,next_lease)<>'retry' then raise exception 'Concurrent loss claimed live lease'; end if;
 begin perform public.complete_stripe_dispute_loss('dp_basket','evt_basket_loss',lease); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Incomplete ledger acknowledged'; end if;
 update public.stripe_dispute_journal set lease_expires_at=now()-interval '1 second' where dispute_id='dp_basket';
 if public.apply_stripe_dispute_event('dp_basket','pi_basket_dispute',10000,'usd','lost',true,'evt_basket_loss',500,next_lease)<>'apply_loss' then raise exception 'Expired loss lease not reclaimed'; end if;
 rejected:=false;
 begin perform public.complete_stripe_dispute_loss('dp_basket','evt_basket_loss',lease); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Stale worker acknowledged'; end if;
 raise notice 'PASS 5: complete basket admission, live lease exclusion and stale completion fencing';
 if has_function_privilege('authenticated','public.apply_stripe_dispute_event(text,text,integer,text,text,boolean,text,bigint,uuid)','execute') or has_table_privilege('authenticated','public.stripe_dispute_journal','select') then raise exception 'Private provider journal exposed'; end if;
 raise notice 'PASS 6: journal and worker mutation remain private';
 raise notice 'all provider-dispute ordering checks passed';
end $$;
rollback;
