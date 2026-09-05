begin;

do $$
declare
 seller uuid:=gen_random_uuid();
 buyer uuid:=gen_random_uuid();
 operator uuid:=gen_random_uuid();
 viewer uuid:=gen_random_uuid();
 oid uuid;
 op uuid;
 adjustment uuid;
 recovery uuid;
 replacement uuid;
 retry uuid;
 result jsonb;
 claim_result text;
 rejected boolean;
 before_count integer;
begin
 insert into auth.users(id,email) values
  (seller,'replacement-retry-seller@drvn.test'),
  (buyer,'replacement-retry-buyer@drvn.test'),
  (operator,'replacement-retry-admin@drvn.test'),
  (viewer,'replacement-retry-viewer@drvn.test');
 insert into public.admin_users(user_id,role) values(operator,'admin'),(viewer,'viewer');
 insert into public.orders(buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency,transfer_reference)
 values(buyer,seller,'paid',10000,1000,10000,'USD','tr_retry_original') returning id into oid;
 insert into public.payments(order_id,provider,provider_reference,status,amount_cents,currency)
 values(oid,'stripe','pi_retry','succeeded',10000,'USD');

 result:=public.record_refund_provider_event(
  'evt_retry_original_success','re_retry_original',null,oid,'pi_retry',3000,'usd','succeeded',
  clock_timestamp(),'txn_retry_original'
 );
 op:=(result->>'operation_id')::uuid;
 perform public.settle_refund_operation(op);
 if public.claim_refund_reversal(op,'replacement-guard','tr_retry_original',2700,'usd','reversal:'||op)<>'claimed' then
  raise exception 'Original retry fixture reversal was not claimed';
 end if;
 if public.complete_refund_reversal(op,'replacement-guard','reversal:'||op,'tr_retry_original',2700,'usd','trr_retry_original')<>'completed' then
  raise exception 'Original retry fixture reversal was not completed';
 end if;
 perform public.record_refund_provider_event(
  'evt_retry_original_failed','re_retry_original',op,oid,'pi_retry',3000,'usd','failed',
  clock_timestamp()+interval '1 second','txn_retry_original','txn_retry_failure','insufficient_funds'
 );
 select id into strict adjustment from public.refund_lifecycle_adjustments where refund_operation_id=op;
 select id into strict recovery from public.payment_recoveries where recovery_key='refund-late-failure:re_retry_original';
 perform public.record_refund_recredit_proof(
  recovery,adjustment,operator,2700,'usd','tr_retry_recredit','trr_retry_original','txn_retry_recredit'
 );

 before_count:=(select count(*) from public.refund_operations where replaces_adjustment_id=adjustment);
 rejected:=false;
 begin
  perform public.begin_refund_replacement(recovery,viewer);
 exception when others then rejected:=true;
 end;
 if not rejected then raise exception 'Viewer actor started a replacement'; end if;
 rejected:=false;
 begin
  perform public.begin_refund_replacement(recovery,gen_random_uuid());
 exception when others then rejected:=true;
 end;
 if not rejected then raise exception 'Unknown actor started a replacement'; end if;
 if (select count(*) from public.refund_operations where replaces_adjustment_id=adjustment)<>before_count then
  raise exception 'Rejected actor mutated replacement state';
 end if;

 replacement:=public.begin_refund_replacement(recovery,operator);
 result:=public.record_refund_provider_event(
  'evt_retry_external_hold','re_retry_external_hold',null,oid,'pi_retry',500,'usd','succeeded',
  clock_timestamp()+interval '2 seconds','txn_retry_external_hold'
 );
 if result->>'action'<>'recovery_recorded' then
  raise exception 'Concurrent external refund was not held before replacement claim';
 end if;
 -- A competing ledger change between reservation and dispatch is rechecked.
 update public.orders set refunded_cents=9000 where id=oid;
 if public.claim_refund_replacement_provider(replacement)<>'recovery_required' then raise exception 'Claim ignored changed refundable ledger'; end if;
 if (select status from public.refund_operations where id=replacement)<>'requested' then raise exception 'Refused claim crossed provider boundary'; end if;
 update public.orders set refunded_cents=0 where id=oid;
 claim_result:=public.claim_refund_replacement_provider(replacement);
 if claim_result<>'recovery_required'
    or (select status from public.refund_operations where id=replacement)<>'requested' then
  raise exception 'Unresolved external refund crossed the replacement provider boundary';
 end if;
 update public.payment_recoveries
 set status='recovered',resolved_by=operator,resolved_at=now(),resolution_note='Fixture provider reconciliation'
 where recovery_key='refund-lifecycle:re_retry_external_hold';
 claim_result:=public.claim_refund_replacement_provider(replacement);
 if claim_result<>'requested'
    or (select status from public.refund_operations where id=replacement)<>'provider_pending' then
  raise exception 'First replacement claim did not durably cross the provider boundary';
 end if;
 if public.claim_refund_replacement_provider(replacement)<>'provider_pending' then
  raise exception 'Replacement claim retry lost its prior provider-boundary state';
 end if;
 perform public.record_refund_provider_event(
  'evt_retry_attempt_failed','re_retry_attempt_one',replacement,oid,'pi_retry',3000,'usd','failed',
  clock_timestamp()+interval '3 seconds',null,'txn_retry_attempt_failure','declined'
 );
 if (select status from public.refund_operations where id=replacement)<>'failed'
    or (select effects_completed_at from public.refund_operations where id=replacement) is not null then
  raise exception 'Definitive early replacement failure was not retained';
 end if;
 retry:=public.begin_refund_replacement(recovery,operator);
 if retry=replacement then raise exception 'Definitive early failure was not retryable'; end if;
 if public.begin_refund_replacement(recovery,operator)<>retry then
  raise exception 'Retry replay duplicated the active replacement';
 end if;
 if (select count(*) from public.refund_operations where replaces_adjustment_id=adjustment)<>2 then
  raise exception 'Definitive early failure retry created an unexpected replacement count';
 end if;
 if (select replacement_transfer_reference from public.refund_operations where id=retry)<>'tr_retry_recredit' then
  raise exception 'Retry lost the immutable seller recredit source';
 end if;
 perform public.record_refund_provider_event(
  'evt_retry_attempt_success','re_retry_attempt_two',retry,oid,'pi_retry',3000,'usd','succeeded',
  clock_timestamp()+interval '4 seconds','txn_retry_attempt_success'
 );
 perform public.settle_refund_operation(retry);
 perform public.claim_refund_reversal(retry,'replacement-guard','tr_retry_recredit',2700,'usd','reversal:'||retry);
 perform public.complete_refund_reversal(retry,'replacement-guard','reversal:'||retry,'tr_retry_recredit',2700,'usd','trr_retry_attempt_success');
 update public.payment_recoveries
 set status='recovered',resolved_by=operator,resolved_at=now(),resolution_note='Replacement retry settled'
 where id=recovery;
 if not exists(
  select 1 from public.payment_recoveries
  where recovery_key='refund-failed:re_retry_attempt_one' and status='recovered'
   and resolved_by=operator and resolution_note like 'Superseded replacement fulfilled; parent recovery %'
 ) then raise exception 'Settled retry left its definitive early-failure recovery open'; end if;
end $$;

do $$
declare
 seller uuid;
 buyer uuid;
 operator uuid;
 oid uuid;
 original uuid;
 adjustment uuid;
 recovery uuid;
 result jsonb;
 provider_created_at timestamptz:=clock_timestamp()+interval '10 seconds';
 rejected boolean;
begin
 select id into strict seller from auth.users where email='replacement-retry-seller@drvn.test';
 select id into strict buyer from auth.users where email='replacement-retry-buyer@drvn.test';
 select id into strict operator from auth.users where email='replacement-retry-admin@drvn.test';
 insert into public.orders(buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency)
 values(buyer,seller,'paid',10000,1000,10000,'USD') returning id into oid;
 insert into public.payments(order_id,provider,provider_reference,status,amount_cents,currency)
 values(oid,'stripe','pi_external_hold','succeeded',10000,'USD');

 result:=public.record_refund_provider_event(
  'evt_external_hold_original_success','re_external_hold_original',null,oid,'pi_external_hold',1000,'usd','succeeded',
  clock_timestamp(),'txn_external_hold_original'
 );
 original:=(result->>'operation_id')::uuid;
 perform public.settle_refund_operation(original);
 perform public.record_refund_provider_event(
  'evt_external_hold_original_failed','re_external_hold_original',original,oid,'pi_external_hold',1000,'usd','failed',
  clock_timestamp()+interval '1 second','txn_external_hold_original','txn_external_hold_failure','late_failure'
 );
 select id into strict adjustment from public.refund_lifecycle_adjustments where refund_operation_id=original;
 select id into strict recovery from public.payment_recoveries where recovery_key='refund-late-failure:re_external_hold_original';
 perform public.record_refund_recredit_proof(recovery,adjustment,operator,0,'usd');

 result:=public.record_refund_provider_event(
  'evt_external_hold_new','re_external_hold_new',null,oid,'pi_external_hold',500,'usd','succeeded',
  provider_created_at,'txn_external_hold_new'
 );
 if result->>'action'<>'recovery_recorded' then
  raise exception 'External provider refund was not held during replacement recovery';
 end if;
 if (select count(*) from public.refund_provider_events where event_id='evt_external_hold_new' and refund_operation_id is null)<>1
    or (select count(*) from public.payment_recoveries where recovery_key='refund-lifecycle:re_external_hold_new' and status='open')<>1 then
  raise exception 'Held external provider refund lacked durable event and recovery evidence';
 end if;
 result:=public.record_refund_provider_event(
  'evt_external_hold_new','re_external_hold_new',null,oid,'pi_external_hold',500,'usd','succeeded',
  provider_created_at,'txn_external_hold_new'
 );
 if coalesce((result->>'replayed')::boolean,false) is not true
    or (select count(*) from public.refund_provider_events where event_id='evt_external_hold_new')<>1
    or (select count(*) from public.payment_recoveries where recovery_key='refund-lifecycle:re_external_hold_new')<>1 then
  raise exception 'External provider refund replay duplicated durable evidence';
 end if;
 rejected:=false;
 begin
  perform public.record_refund_provider_event(
   'evt_external_hold_new','re_external_hold_new',null,oid,'pi_external_hold',501,'usd','succeeded',
   provider_created_at,'txn_external_hold_new'
  );
 exception when others then rejected:=true;
 end;
 if not rejected then raise exception 'Changed external provider event replay was accepted'; end if;

 rejected:=false;
 begin
  perform public.begin_refund_replacement(recovery,operator);
 exception when others then rejected:=true;
 end;
 if not rejected then raise exception 'Replacement started while external refund evidence was unresolved'; end if;
 if exists(select 1 from public.refund_operations where replaces_adjustment_id=adjustment) then
  raise exception 'External refund admission failure inserted a replacement';
 end if;
 if (select refunded_cents from public.orders where id=oid)<>0
    or (select refunded_cents from public.payments where order_id=oid)<>0 then
  raise exception 'Held external provider refund changed local money counters';
 end if;
end $$;

do $$
declare
 seller uuid;
 buyer uuid;
 operator uuid;
 oid uuid;
 op uuid;
 replacement_one uuid;
 replacement_two uuid;
 replacement_three uuid;
 adjustment_one uuid;
 adjustment_two uuid;
 adjustment_three uuid;
 recovery_one uuid;
 recovery_two uuid;
 recovery_three uuid;
 result jsonb;
 rejected boolean;
begin
 select id into strict seller from auth.users where email='replacement-retry-seller@drvn.test';
 select id into strict buyer from auth.users where email='replacement-retry-buyer@drvn.test';
 select id into strict operator from auth.users where email='replacement-retry-admin@drvn.test';
 insert into public.orders(buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency,transfer_reference)
 values(buyer,seller,'paid',10000,1000,10000,'USD','tr_chain_original') returning id into oid;
 insert into public.payments(order_id,provider,provider_reference,status,amount_cents,currency)
 values(oid,'stripe','pi_chain','succeeded',10000,'USD');

 result:=public.record_refund_provider_event(
  'evt_chain_original_success','re_chain_original',null,oid,'pi_chain',3000,'usd','succeeded',
  clock_timestamp(),'txn_chain_original'
 );
 op:=(result->>'operation_id')::uuid;
 perform public.settle_refund_operation(op);
 perform public.claim_refund_reversal(op,'replacement-guard','tr_chain_original',2700,'usd','reversal:'||op);
 perform public.complete_refund_reversal(op,'replacement-guard','reversal:'||op,'tr_chain_original',2700,'usd','trr_chain_original');
 perform public.record_refund_provider_event(
  'evt_chain_original_failed','re_chain_original',op,oid,'pi_chain',3000,'usd','failed',
  clock_timestamp()+interval '1 second','txn_chain_original','txn_chain_original_failure','late_failure'
 );
 select id into strict adjustment_one from public.refund_lifecycle_adjustments where refund_operation_id=op;
 select id into strict recovery_one from public.payment_recoveries where recovery_key='refund-late-failure:re_chain_original';
 perform public.record_refund_recredit_proof(
  recovery_one,adjustment_one,operator,2700,'usd','tr_chain_recredit_one','trr_chain_original','txn_chain_recredit_one'
 );
 replacement_one:=public.begin_refund_replacement(recovery_one,operator);

 perform public.record_refund_provider_event(
  'evt_chain_one_success','re_chain_one',replacement_one,oid,'pi_chain',3000,'usd','succeeded',
  clock_timestamp()+interval '2 seconds','txn_chain_one'
 );
 perform public.settle_refund_operation(replacement_one);
 perform public.claim_refund_reversal(replacement_one,'replacement-guard','tr_chain_recredit_one',2700,'usd','reversal:'||replacement_one);
 perform public.complete_refund_reversal(replacement_one,'replacement-guard','reversal:'||replacement_one,'tr_chain_recredit_one',2700,'usd','trr_chain_one');
 perform public.record_refund_provider_event(
  'evt_chain_one_failed','re_chain_one',replacement_one,oid,'pi_chain',3000,'usd','failed',
  clock_timestamp()+interval '3 seconds','txn_chain_one','txn_chain_one_failure','late_failure'
 );
 select id into strict adjustment_two from public.refund_lifecycle_adjustments where refund_operation_id=replacement_one;
 select id into strict recovery_two from public.payment_recoveries where recovery_key='refund-late-failure:re_chain_one';
 perform public.record_refund_recredit_proof(
  recovery_two,adjustment_two,operator,2700,'usd','tr_chain_recredit_two','trr_chain_one','txn_chain_recredit_two'
 );
 replacement_two:=public.begin_refund_replacement(recovery_two,operator);
 if replacement_two=replacement_one or
    (select replaces_adjustment_id from public.refund_operations where id=replacement_two)<>adjustment_two then
  raise exception 'First repeated late failure did not create a child-linked replacement';
 end if;

 perform public.record_refund_provider_event(
  'evt_chain_two_success','re_chain_two',replacement_two,oid,'pi_chain',3000,'usd','succeeded',
  clock_timestamp()+interval '4 seconds','txn_chain_two'
 );
 perform public.settle_refund_operation(replacement_two);
 perform public.claim_refund_reversal(replacement_two,'replacement-guard','tr_chain_recredit_two',2700,'usd','reversal:'||replacement_two);
 perform public.complete_refund_reversal(replacement_two,'replacement-guard','reversal:'||replacement_two,'tr_chain_recredit_two',2700,'usd','trr_chain_two');
 perform public.record_refund_provider_event(
  'evt_chain_two_failed','re_chain_two',replacement_two,oid,'pi_chain',3000,'usd','failed',
  clock_timestamp()+interval '5 seconds','txn_chain_two','txn_chain_two_failure','late_failure'
 );
 select id into strict adjustment_three from public.refund_lifecycle_adjustments where refund_operation_id=replacement_two;
 select id into strict recovery_three from public.payment_recoveries where recovery_key='refund-late-failure:re_chain_two';
 perform public.record_refund_recredit_proof(
  recovery_three,adjustment_three,operator,2700,'usd','tr_chain_recredit_three','trr_chain_two','txn_chain_recredit_three'
 );
 replacement_three:=public.begin_refund_replacement(recovery_three,operator);
 if replacement_three in (replacement_one,replacement_two) or
    (select replaces_adjustment_id from public.refund_operations where id=replacement_three)<>adjustment_three then
  raise exception 'Second repeated late failure did not extend the replacement chain';
 end if;
 if public.begin_refund_replacement(recovery_one,operator)<>replacement_one
    or public.begin_refund_replacement(recovery_two,operator)<>replacement_two
    or public.begin_refund_replacement(recovery_three,operator)<>replacement_three then
  raise exception 'Replacement chain replay did not adopt the linked operation';
 end if;

 rejected:=false;
 begin
  update public.payment_recoveries set status='recovered' where id=recovery_one;
 exception when others then rejected:=true;
 end;
 if not rejected then raise exception 'Ancestor recovery closed while its replacement chain remained open'; end if;

 perform public.record_refund_provider_event(
  'evt_chain_three_success','re_chain_three',replacement_three,oid,'pi_chain',3000,'usd','succeeded',
  clock_timestamp()+interval '6 seconds','txn_chain_three'
 );
 perform public.settle_refund_operation(replacement_three);
 perform public.claim_refund_reversal(replacement_three,'replacement-guard','tr_chain_recredit_three',2700,'usd','reversal:'||replacement_three);
 perform public.complete_refund_reversal(replacement_three,'replacement-guard','reversal:'||replacement_three,'tr_chain_recredit_three',2700,'usd','trr_chain_three');
 update public.payment_recoveries set status='recovered',resolved_by=operator,resolved_at=now(),resolution_note='Final chain replacement settled' where id=recovery_three;
 update public.payment_recoveries set status='recovered',resolved_by=operator,resolved_at=now(),resolution_note='Child recovery settled' where id=recovery_two;
 update public.payment_recoveries set status='recovered',resolved_by=operator,resolved_at=now(),resolution_note='Replacement chain settled' where id=recovery_one;
 if exists(select 1 from public.payment_recoveries where id in (recovery_one,recovery_two,recovery_three) and status<>'recovered') then
  raise exception 'Settled replacement chain could not close in dependency order';
 end if;
end $$;

do $$
declare
 seller uuid;
 buyer uuid;
 operator uuid;
 oid uuid;
 op uuid;
 adjustment uuid;
 recovery uuid;
 replacement uuid;
 race_oid uuid;
 race_op uuid;
 race_adjustment uuid;
 race_recovery uuid;
 result jsonb;
 rejected boolean;
begin
 select id into strict seller from auth.users where email='replacement-retry-seller@drvn.test';
 select id into strict buyer from auth.users where email='replacement-retry-buyer@drvn.test';
 select id into strict operator from auth.users where email='replacement-retry-admin@drvn.test';
 insert into public.orders(buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency)
 values(buyer,seller,'paid',10000,1000,10000,'USD') returning id into oid;
 insert into public.payments(order_id,provider,provider_reference,status,amount_cents,currency)
 values(oid,'stripe','pi_zero','succeeded',10000,'USD');
 result:=public.record_refund_provider_event(
  'evt_zero_original_success','re_zero_original',null,oid,'pi_zero',1000,'usd','succeeded',
  clock_timestamp(),'txn_zero_original'
 );
 op:=(result->>'operation_id')::uuid;
 perform public.settle_refund_operation(op);
 if (select status from public.refund_operations where id=op)<>'completed'
    or (select reversal_due_cents from public.refund_operations where id=op)<>0 then
  raise exception 'Zero-obligation fixture unexpectedly required a reversal';
 end if;
 perform public.record_refund_provider_event(
  'evt_zero_original_failed','re_zero_original',op,oid,'pi_zero',1000,'usd','failed',
  clock_timestamp()+interval '1 second','txn_zero_original','txn_zero_failure','late_failure'
 );
 select id into strict adjustment from public.refund_lifecycle_adjustments where refund_operation_id=op;
 select id into strict recovery from public.payment_recoveries where recovery_key='refund-late-failure:re_zero_original';
 if (select seller_recredit_cents from public.refund_lifecycle_adjustments where id=adjustment)<>0 then
  raise exception 'Zero seller obligation was not frozen';
 end if;
 perform public.record_refund_recredit_proof(recovery,adjustment,operator,0,'usd');
 replacement:=public.begin_refund_replacement(recovery,operator);
 if (select replacement_transfer_reference from public.refund_operations where id=replacement) is not null then
  raise exception 'Zero-obligation replacement acquired a seller transfer source';
 end if;
 perform public.record_refund_provider_event(
  'evt_zero_replacement_success','re_zero_replacement',replacement,oid,'pi_zero',1000,'usd','succeeded',
  clock_timestamp()+interval '2 seconds','txn_zero_replacement'
 );
 perform public.settle_refund_operation(replacement);
 if (select status from public.refund_operations where id=replacement)<>'completed'
    or (select reversal_due_cents from public.refund_operations where id=replacement)<>0 then
  raise exception 'Zero-obligation replacement created a seller reversal';
 end if;

 -- A second zero-obligation failure exercises the payout race before any
 -- replacement is reserved.
 insert into public.orders(buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency)
 values(buyer,seller,'paid',10000,1000,10000,'USD') returning id into race_oid;
 insert into public.payments(order_id,provider,provider_reference,status,amount_cents,currency)
 values(race_oid,'stripe','pi_zero_race','succeeded',10000,'USD');
 result:=public.record_refund_provider_event(
  'evt_zero_race_success','re_zero_race',null,race_oid,'pi_zero_race',1000,'usd','succeeded',
  clock_timestamp()+interval '3 seconds','txn_zero_race'
 );
 race_op:=(result->>'operation_id')::uuid;
 perform public.settle_refund_operation(race_op);
 perform public.record_refund_provider_event(
  'evt_zero_race_failed','re_zero_race',race_op,race_oid,'pi_zero_race',1000,'usd','failed',
  clock_timestamp()+interval '4 seconds','txn_zero_race','txn_zero_race_failure','late_failure'
 );
 select id into strict race_adjustment from public.refund_lifecycle_adjustments where refund_operation_id=race_op;
 select id into strict race_recovery from public.payment_recoveries where recovery_key='refund-late-failure:re_zero_race';
 perform public.record_refund_recredit_proof(race_recovery,race_adjustment,operator,0,'usd');

 insert into public.transfer_intents(order_id,seller_id,amount_cents,currency,status)
 values(race_oid,seller,9000,'USD','ready');
 rejected:=false;
 begin
  update public.transfer_intents set provider_call_may_have_occurred=true where order_id=race_oid;
 exception when others then rejected:=true;
 end;
 if not rejected then raise exception 'Fresh seller payout dispatched during late-refund recovery'; end if;
 if (select provider_call_may_have_occurred from public.transfer_intents where order_id=race_oid) then
  raise exception 'Rejected payout dispatch retained its provider-boundary marker';
 end if;

 -- A payout that already appeared after the failed refund changes the
 -- immutable zero obligation. Refuse replacement rather than reclaiming it.
 update public.transfer_intents set status='cancelled' where order_id=race_oid;
 update public.orders set transfer_reference='tr_zero_later' where id=race_oid;
 rejected:=false;
 begin
  perform public.begin_refund_replacement(race_recovery,operator);
 exception when others then rejected:=true;
 end;
 if not rejected then raise exception 'Zero-obligation replacement reclaimed a later payout'; end if;
 if exists(select 1 from public.refund_operations where replaces_adjustment_id=race_adjustment) then
  raise exception 'Rejected later-payout race inserted a replacement';
 end if;
end $$;

do $$
declare
 seller uuid;
 buyer uuid;
 operator uuid;
 oid uuid;
 original uuid;
 concurrent_refund uuid;
 adjustment uuid;
 recovery uuid;
 result jsonb;
 rejected boolean;
begin
 select id into strict seller from auth.users where email='replacement-retry-seller@drvn.test';
 select id into strict buyer from auth.users where email='replacement-retry-buyer@drvn.test';
 select id into strict operator from auth.users where email='replacement-retry-admin@drvn.test';
 insert into public.orders(buyer_id,seller_id,status,subtotal_cents,platform_fee_cents,total_cents,currency,transfer_reference)
 values(buyer,seller,'paid',10000,1000,10000,'USD','tr_rounding_original') returning id into oid;
 insert into public.payments(order_id,provider,provider_reference,status,amount_cents,currency)
 values(oid,'stripe','pi_rounding','succeeded',10000,'USD');

 result:=public.record_refund_provider_event(
  'evt_rounding_original_success','re_rounding_original',null,oid,'pi_rounding',1,'usd','succeeded',
  clock_timestamp(),'txn_rounding_original'
 );
 original:=(result->>'operation_id')::uuid;
 perform public.settle_refund_operation(original);
 perform public.claim_refund_reversal(original,'replacement-guard','tr_rounding_original',1,'usd','reversal:'||original);
 perform public.complete_refund_reversal(original,'replacement-guard','reversal:'||original,'tr_rounding_original',1,'usd','trr_rounding_original');

 result:=public.begin_refund_operation(
  oid,5,'Concurrent rounding refund','replacement-guard','admin',false,null,'pi_rounding',null,false
 );
 concurrent_refund:=(result->>'operation_id')::uuid;
 perform public.record_refund_provider_event(
  'evt_rounding_original_failed','re_rounding_original',original,oid,'pi_rounding',1,'usd','failed',
  clock_timestamp()+interval '1 second','txn_rounding_original','txn_rounding_failure','late_failure'
 );
 perform public.record_refund_provider_event(
  'evt_rounding_concurrent_success','re_rounding_concurrent',concurrent_refund,oid,'pi_rounding',5,'usd','succeeded',
  clock_timestamp()+interval '2 seconds','txn_rounding_concurrent'
 );
 perform public.settle_refund_operation(concurrent_refund);
 perform public.claim_refund_reversal(concurrent_refund,'replacement-guard','tr_rounding_original',5,'usd','reversal:'||concurrent_refund);
 perform public.complete_refund_reversal(concurrent_refund,'replacement-guard','reversal:'||concurrent_refund,'tr_rounding_original',5,'usd','trr_rounding_concurrent');

 select id into strict adjustment from public.refund_lifecycle_adjustments where refund_operation_id=original;
 select id into strict recovery from public.payment_recoveries where recovery_key='refund-late-failure:re_rounding_original';
 perform public.record_refund_recredit_proof(
  recovery,adjustment,operator,1,'usd','tr_rounding_recredit','trr_rounding_original','txn_rounding_recredit'
 );
 rejected:=false;
 begin
  perform public.begin_refund_replacement(recovery,operator);
 exception when others then rejected:=true;
 end;
 if not rejected then raise exception 'Changed partial-refund allocation was silently accepted'; end if;
 if exists(select 1 from public.refund_operations where replaces_adjustment_id=adjustment) then
  raise exception 'Changed allocation rejection inserted a replacement';
 end if;
end $$;

do $$
begin
 if has_function_privilege('authenticated','public.begin_refund_replacement(uuid,uuid)','execute') then
  raise exception 'Authenticated client can execute linked refund replacement';
 end if;
 raise notice 'all linked refund replacement checks passed';
end $$;

rollback;
