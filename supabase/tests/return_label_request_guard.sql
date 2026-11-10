-- Durable return-label request guard. Disposable local database only.
begin;

create or replace function pg_temp.reject_return_label_completion()
returns trigger language plpgsql as $$
begin
  if new.label->>'trackingCode' = 'FAIL-ROLLBACK' then
    raise exception 'injected return label completion failure';
  end if;
  return new;
end;
$$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (architecture plan 2, item A3), so they are opened here.
grant execute on all routines in schema pg_temp to public;

create trigger return_label_completion_injected_failure
before update on public.return_label_requests
for each row execute function pg_temp.reject_return_label_completion();

do $$
declare
  v_seller uuid := gen_random_uuid();
  v_buyer uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_listing uuid;
  v_order uuid;
  v_first_item uuid;
  v_second_item uuid;
  v_return uuid;
  v_failed_order uuid;
  v_failed_item uuid;
  v_failed_return uuid;
  v_shipment uuid;
  v_failed_shipment uuid;
  v_completed_at timestamptz;
  rated jsonb := jsonb_build_object(
    'shipmentRef', 'ret-shipment-winner',
    'rateRef', 'ret-rate-winner',
    'amountCents', 875,
    'currency', 'USD',
    'carrier', 'USPS',
    'service', 'Priority',
    'endShipperRef', null
  );
  losing_rate jsonb := jsonb_build_object(
    'shipmentRef', 'ret-shipment-loser',
    'rateRef', 'ret-rate-loser',
    'amountCents', 925,
    'currency', 'USD',
    'carrier', 'UPS',
    'service', 'Ground',
    'endShipperRef', null
  );
  v_label jsonb := jsonb_build_object(
    'shipmentRef', 'ret-shipment-winner',
    'labelUrl', 'https://labels.example.test/return-winner.pdf',
    'trackingCode', 'RETURN-TRACK-WINNER',
    'carrier', 'USPS',
    'service', 'Priority',
    'amountCents', 875,
    'currency', 'USD',
    'trackerRef', 'tracker-return-winner'
  );
  result jsonb;
  rejected boolean;
begin
  if has_function_privilege(
    'anon', 'public.prepare_return_label(uuid,uuid,text,jsonb)', 'execute'
  ) or has_function_privilege(
    'authenticated', 'public.prepare_return_label(uuid,uuid,text,jsonb)', 'execute'
  ) or has_function_privilege(
    'anon', 'public.complete_return_label(uuid,jsonb)', 'execute'
  ) or has_function_privilege(
    'authenticated', 'public.complete_return_label(uuid,jsonb)', 'execute'
  ) or has_function_privilege(
    'anon', 'public.mark_return_dispatched(uuid,uuid,text,text)', 'execute'
  ) or has_function_privilege(
    'authenticated', 'public.mark_return_dispatched(uuid,uuid,text,text)', 'execute'
  ) then
    raise exception 'A client role can execute a privileged return-label transition';
  end if;
  if has_table_privilege('anon', 'public.return_label_requests', 'select')
     or has_table_privilege('authenticated', 'public.return_label_requests', 'select')
     or has_table_privilege('authenticated', 'public.return_label_requests', 'insert')
     or has_table_privilege('authenticated', 'public.return_label_requests', 'update') then
    raise exception 'A client role can inspect or mutate durable return-label requests';
  end if;

  insert into auth.users(id, email) values
    (v_seller, 'return-label-seller@drvn.test'),
    (v_buyer, 'return-label-buyer@drvn.test'),
    (v_outsider, 'return-label-outsider@drvn.test');
  insert into public.listings(
    seller_id, title, category, price_cents, shipping_cents, currency, status
  ) values(
    v_seller, 'Return label guard part', 'engine', 12000, 1000, 'USD', 'sold'
  ) returning id into v_listing;
  insert into public.orders(
    buyer_id, seller_id, status, subtotal_cents, shipping_cents,
    platform_fee_cents, total_cents, currency, is_collection
  ) values(
    v_buyer, v_seller, 'paid', 12000, 1000, 1300, 13000, 'USD', false
  ) returning id into v_order;
  insert into public.order_items(order_id, listing_id, title, price_cents, shipping_cents)
  values(v_order, v_listing, 'Returned engine part A', 7000, 600)
  returning id into v_first_item;
  insert into public.order_items(order_id, title, price_cents, shipping_cents)
  values(v_order, 'Returned engine part B', 5000, 400)
  returning id into v_second_item;
  insert into public.returns(
    order_id, requested_by, return_type, responsibility, status, approved_at, ship_by
  ) values(
    v_order, v_buyer, 'protection', 'seller', 'awaiting_shipment', now(), now() + interval '7 days'
  ) returning id into v_return;
  insert into public.return_items(return_id, order_item_id)
  values(v_return, v_first_item), (v_return, v_second_item);

  rejected := false;
  begin
    perform public.prepare_return_label(v_return, v_outsider, 'stub', rated);
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected
     or exists(select 1 from public.shipments s where s.return_id = v_return)
     or exists(select 1 from public.return_label_requests q where q.return_id = v_return) then
    raise exception 'Unauthorized preparation created return-label state';
  end if;

  result := public.prepare_return_label(v_return, v_buyer, 'stub', rated);
  v_shipment := (result->>'shipment_id')::uuid;
  if result->'rated' is distinct from rated
     or (select count(*) from public.shipments s where s.return_id = v_return and s.status not in ('cancelled', 'failed')) <> 1
     or not exists(
       select 1 from public.shipments s
       where s.id = v_shipment and s.order_id = v_order and s.direction = 'return'
         and s.provider = 'stub' and s.provider_shipment_id = 'ret-shipment-winner'
         and s.fulfillment_type = 'drvn_shipping' and s.status = 'pending'
     )
     or (select count(*) from public.shipment_items si where si.shipment_id = v_shipment) <> 2
     or (select count(*) from public.admin_alert_outbox where dedup_key = 'return-label:' || v_return) <> 1 then
    raise exception 'Preparation did not atomically freeze one provider shipment and its items';
  end if;

  result := public.prepare_return_label(v_return, v_buyer, 'stub', rated);
  if (result->>'shipment_id')::uuid is distinct from v_shipment
     or result->'rated' is distinct from rated
     or (select count(*) from public.shipments s where s.return_id = v_return and s.status not in ('cancelled', 'failed')) <> 1 then
    raise exception 'Exact preparation replay duplicated or changed the provider shipment';
  end if;

  -- A concurrent same-provider rate can lose without buying a second label:
  -- the durable winner, including its rate reference and amount, is returned.
  result := public.prepare_return_label(v_return, v_buyer, 'stub', losing_rate);
  if (result->>'shipment_id')::uuid is distinct from v_shipment
     or result->'rated' is distinct from rated then
    raise exception 'Concurrent rating replay did not adopt the frozen winner';
  end if;
  rejected := false;
  begin
    update public.return_label_requests set rated = losing_rate where return_id = v_return;
  exception when others then
    rejected := true;
  end;
  if not rejected
     or (select q.rated from public.return_label_requests q where q.return_id = v_return)
       is distinct from rated then
    raise exception 'Frozen return-label request identity was mutable';
  end if;
  rejected := false;
  begin
    perform public.prepare_return_label(v_return, v_buyer, 'easypost', rated);
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'Changed provider replay was accepted'; end if;

  rejected := false;
  begin
    perform public.complete_return_label(
      v_return,
      v_label || jsonb_build_object('amountCents', 876)
    );
  exception when others then
    rejected := true;
  end;
  if not rejected
     or (select status from public.shipments where id = v_shipment) <> 'pending'
     or exists(select 1 from public.seller_adjustments a where a.return_id = v_return)
     or (select q.completed_at from public.return_label_requests q where q.return_id = v_return) is not null then
    raise exception 'A mismatched purchased label changed durable state';
  end if;

  rejected := false;
  begin
    perform public.mark_return_dispatched(v_return, v_buyer, 'USPS', 'MANUAL-BEFORE-LABEL');
  exception when others then
    rejected := true;
  end;
  if not rejected
     or (select status from public.returns where id = v_return) <> 'awaiting_shipment'
     or (select status from public.shipments where id = v_shipment) <> 'pending' then
    raise exception 'Manual dispatch bypassed pending prepaid-label reconciliation';
  end if;

  result := public.complete_return_label(v_return, v_label);
  if coalesce((result->>'ok')::boolean, false) is not true
     or result->'label' is distinct from v_label
     or not exists(
       select 1 from public.shipments s
       where s.id = v_shipment and s.status = 'label_purchased'
         and s.provider_tracker_id = 'tracker-return-winner'
         and s.tracking_code = 'RETURN-TRACK-WINNER'
         and s.label_reference = 'https://labels.example.test/return-winner.pdf'
         and s.purchased_cents = 875
     )
     or (select count(*) from public.shipment_items si where si.shipment_id = v_shipment) <> 2
     or not exists(
       select 1 from public.seller_adjustments a
       where a.return_id = v_return and a.order_id = v_order
         and a.shipment_id = v_shipment and a.seller_id = v_seller
         and a.kind = 'return_label' and a.amount_cents = -875 and a.currency = 'USD'
         and a.external_reference = 'retlabel:' || v_return
     )
     or not exists(
       select 1 from public.return_label_requests q
       where q.return_id = v_return and q.completed_at is not null and q.label = v_label
     )
     or exists(select 1 from public.admin_alert_outbox where dedup_key = 'return-label:' || v_return and status = 'pending') then
    raise exception 'Completion did not atomically persist the label, links, and seller expense';
  end if;
  select q.completed_at into strict v_completed_at
  from public.return_label_requests q where q.return_id = v_return;

  result := public.complete_return_label(v_return, v_label);
  if coalesce((result->>'ok')::boolean, false) is not true
     or (select q.completed_at from public.return_label_requests q where q.return_id = v_return)
       is distinct from v_completed_at
     or (select count(*) from public.seller_adjustments a where a.return_id = v_return) <> 1 then
    raise exception 'Exact completion replay duplicated or restamped durable effects';
  end if;
  rejected := false;
  begin
    perform public.complete_return_label(
      v_return,
      v_label || jsonb_build_object('trackingCode', 'RETURN-TRACK-CHANGED')
    );
  exception when others then
    rejected := true;
  end;
  if not rejected then raise exception 'Changed purchased-label replay was accepted'; end if;

  rejected := false;
  begin
    perform public.mark_return_dispatched(v_return, v_outsider, 'USPS', 'RETURN-TRACK-WINNER');
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected or (select status from public.returns where id = v_return) <> 'awaiting_shipment' then
    raise exception 'Unauthorized return dispatch changed durable state';
  end if;

  result := public.mark_return_dispatched(v_return, v_buyer, 'USPS', 'RETURN-TRACK-WINNER');
  if coalesce((result->>'ok')::boolean, false) is not true
     or coalesce((result->>'applied')::boolean, false) is not true
     or coalesce((result->>'manual')::boolean, true) is not false
     or (result->>'shipment_id')::uuid is distinct from v_shipment
     or (select status from public.returns where id = v_return) <> 'in_transit'
     or (select status from public.shipments where id = v_shipment) <> 'in_transit'
     or (select shipped_at from public.returns where id = v_return) is null
     or (select shipped_at from public.shipments where id = v_shipment) is null then
    raise exception 'Completed prepaid label did not dispatch return and shipment atomically';
  end if;
  result := public.mark_return_dispatched(v_return, v_buyer, 'USPS', 'RETURN-TRACK-WINNER');
  if coalesce((result->>'ok')::boolean, false) is not true
     or coalesce((result->>'applied')::boolean, true) is not false
     or (result->>'shipment_id')::uuid is distinct from v_shipment
     or (select count(*) from public.shipments s where s.return_id = v_return and s.status not in ('cancelled', 'failed')) <> 1 then
    raise exception 'Exact prepaid-label dispatch replay duplicated fulfillment';
  end if;
  rejected := false;
  begin
    perform public.mark_return_dispatched(v_return, v_buyer, 'USPS', 'RETURN-TRACK-CHANGED');
  exception when others then
    rejected := true;
  end;
  if not rejected
     or (select tracking_code from public.shipments where id = v_shipment) <> 'RETURN-TRACK-WINNER' then
    raise exception 'Changed prepaid-label tracking replay was accepted';
  end if;

  -- A second return proves every completion effect rolls back together. Remove
  -- the prepared item link first so completion has to repair it before the
  -- injected failure at its final request update.
  insert into public.orders(
    buyer_id, seller_id, status, subtotal_cents, shipping_cents,
    platform_fee_cents, total_cents, currency, is_collection
  ) values(
    v_buyer, v_seller, 'paid', 4000, 500, 450, 4500, 'USD', false
  ) returning id into v_failed_order;
  insert into public.order_items(order_id, title, price_cents, shipping_cents)
  values(v_failed_order, 'Rollback return part', 4000, 500)
  returning id into v_failed_item;
  insert into public.returns(
    order_id, requested_by, return_type, responsibility, status, approved_at, ship_by
  ) values(
    v_failed_order, v_buyer, 'protection', 'seller', 'awaiting_shipment', now(), now() + interval '7 days'
  ) returning id into v_failed_return;
  insert into public.return_items(return_id, order_item_id)
  values(v_failed_return, v_failed_item);
  result := public.prepare_return_label(
    v_failed_return,
    v_buyer,
    'stub',
    rated || jsonb_build_object('shipmentRef', 'rollback-shipment', 'rateRef', 'rollback-rate')
  );
  v_failed_shipment := (result->>'shipment_id')::uuid;
  delete from public.shipment_items where shipment_id = v_failed_shipment;

  rejected := false;
  begin
    perform public.complete_return_label(
      v_failed_return,
      v_label || jsonb_build_object(
        'shipmentRef', 'rollback-shipment',
        'trackingCode', 'FAIL-ROLLBACK',
        'trackerRef', 'rollback-tracker'
      )
    );
  exception when others then
    rejected := true;
  end;
  if not rejected
     or not exists(
       select 1 from public.shipments s
       where s.id = v_failed_shipment and s.status = 'pending'
         and s.tracking_code is null and s.label_reference is null and s.purchased_cents is null
     )
     or exists(select 1 from public.shipment_items where shipment_id = v_failed_shipment)
     or exists(select 1 from public.seller_adjustments where return_id = v_failed_return)
     or exists(
       select 1 from public.return_label_requests q
       where q.return_id = v_failed_return and (q.completed_at is not null or q.label is not null)
     ) then
    raise exception 'Injected completion failure left partial label effects';
  end if;

  raise notice 'all durable return-label request checks passed';
end;
$$;

rollback;
