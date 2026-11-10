-- Architecture remediation plan 2, item A2, first of two (20261110180000):
-- the changes to an order's status that the application used to make with
-- its own updates are made by database functions, on the same conditions.
--
--   1. Tracking, paid -> shipped: moves a paid order once and records the
--      carrier; a replay changes nothing; an order in an open case keeps its
--      case and now resolves to 'shipped'; anything else is left alone and
--      its status reported; no such order answers null.
--   2. Tracking, shipped -> delivered: the same shape. A paid order is never
--      marked delivered by it.
--   3. A dispute closed without a refund: the buyer closes their own (not
--      someone else's); support resolves for the seller; the order returns to
--      the status it had before the dispute, 'delivered' when none was
--      recorded; the refund offer is withdrawn; a settled dispute answers
--      null; the outcome and who is asking must agree.
--   4. Clients cannot call any of the three; the server can.
--   6. Nothing was lost with the two application branches that were removed
--      (a card dispute opened; a card dispute won): the database makes both
--      changes itself, through apply_stripe_dispute_event, as it has since
--      20261107130000.
--   5. The rules that already guarded these changes still do, inside the
--      functions: an order the payout deadline has claimed (it is being
--      cancelled and refunded) is not marked shipped or delivered by
--      tracking, as it was not when the application made the update (LS002).
-- Disposable database only; everything rolls back.
begin;

create function pg_temp.new_order(p_buyer uuid, p_seller uuid, p_status text, p_before text default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.orders(
    buyer_id, seller_id, status, pre_dispute_status, disputed_at, dispute_category, dispute_reason,
    subtotal_cents, platform_fee_cents, total_cents, currency
  ) values (
    p_buyer, p_seller, p_status, p_before,
    case when p_status = 'disputed' then now() end,
    case when p_status = 'disputed' then 'other' end,
    case when p_status = 'disputed' then 'Guard dispute' end,
    10000, 1000, 10000, 'USD'
  ) returning id into v;
  return v;
end $$;

do $$
declare
  buyer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  -- A time that is not now(), so a function that stamped its own clock would be caught. Relative: no calendar date in a test.
  at_time timestamptz := date_trunc('second', now()) - interval '3 days';
  o uuid;
  row public.orders;
  answer text;
  rejected boolean;
  fn text;
  lease uuid := gen_random_uuid();
begin
  insert into auth.users(id, email) values
    (buyer, 'moves-buyer@drvn.test'), (seller, 'moves-seller@drvn.test'), (other, 'moves-other@drvn.test');

  -- ==========================================================
  -- 1. Tracking: paid -> shipped
  -- ==========================================================
  o := pg_temp.new_order(buyer, seller, 'paid');
  answer := public.order_mark_shipped_from_tracking(o, at_time, 'UPS', '1ZGUARD');
  select * into row from public.orders where id = o;
  if answer is distinct from 'moved' or row.status <> 'shipped' or row.shipped_at <> at_time
     or row.carrier is distinct from 'UPS' or row.tracking_number is distinct from '1ZGUARD' then
    raise exception 'FAIL 1a: a paid order was not marked shipped with its carrier (answer %, status %)', answer, row.status;
  end if;
  answer := public.order_mark_shipped_from_tracking(o, at_time + interval '1 hour', 'FedEx', 'OTHER');
  select * into row from public.orders where id = o;
  if answer is distinct from 'unchanged:shipped' or row.shipped_at <> at_time or row.carrier <> 'UPS' or row.tracking_number <> '1ZGUARD' then
    raise exception 'FAIL 1b: a replay changed a shipped order (answer %)', answer;
  end if;

  o := pg_temp.new_order(buyer, seller, 'disputed', 'paid');
  answer := public.order_mark_shipped_from_tracking(o, at_time, 'UPS', '1ZCASE');
  select * into row from public.orders where id = o;
  if answer is distinct from 'moved_in_case' or row.status <> 'disputed' or row.pre_dispute_status <> 'shipped'
     or row.shipped_at <> at_time or row.tracking_number is distinct from '1ZCASE' then
    raise exception 'FAIL 1c: an open case on an undispatched order did not stay open and resolve to shipped (answer %, status %, before %)', answer, row.status, row.pre_dispute_status;
  end if;

  o := pg_temp.new_order(buyer, seller, 'pending');
  answer := public.order_mark_shipped_from_tracking(o, at_time, 'UPS', '1ZPENDING');
  select * into row from public.orders where id = o;
  if answer is distinct from 'unchanged:pending' or row.status <> 'pending' or row.shipped_at is not null or row.carrier is not null then
    raise exception 'FAIL 1d: an unpaid order was touched by tracking (answer %, status %)', answer, row.status;
  end if;

  -- A shipment with no carrier or code recorded: the order moves and holds null for both.
  o := pg_temp.new_order(buyer, seller, 'paid');
  answer := public.order_mark_shipped_from_tracking(o, at_time);
  select * into row from public.orders where id = o;
  if answer is distinct from 'moved' or row.status <> 'shipped' or row.carrier is not null or row.tracking_number is not null then
    raise exception 'FAIL 1g: a shipment with no carrier did not mark the order shipped with nulls (answer %)', answer;
  end if;

  if public.order_mark_shipped_from_tracking(gen_random_uuid(), at_time, 'UPS', '1ZNONE') is not null then
    raise exception 'FAIL 1e: an order that does not exist did not answer null';
  end if;
  rejected := false;
  begin perform public.order_mark_shipped_from_tracking(o, null, 'UPS', '1Z'); exception when others then rejected := true; end;
  if not rejected then raise exception 'FAIL 1f: a shipment with no time was accepted'; end if;
  raise notice 'PASS 1: tracking marks a paid order shipped once, keeps an open case open, and leaves every other order alone';

  -- ==========================================================
  -- 2. Tracking: shipped -> delivered
  -- ==========================================================
  o := pg_temp.new_order(buyer, seller, 'shipped');
  answer := public.order_mark_delivered_from_tracking(o, at_time);
  select * into row from public.orders where id = o;
  if answer is distinct from 'moved' or row.status <> 'delivered' or row.delivered_at <> at_time then
    raise exception 'FAIL 2a: a shipped order was not marked delivered (answer %, status %)', answer, row.status;
  end if;
  answer := public.order_mark_delivered_from_tracking(o, at_time + interval '1 day');
  select * into row from public.orders where id = o;
  if answer is distinct from 'unchanged:delivered' or row.delivered_at <> at_time then
    raise exception 'FAIL 2b: a replay changed a delivered order (answer %)', answer;
  end if;

  o := pg_temp.new_order(buyer, seller, 'paid');
  answer := public.order_mark_delivered_from_tracking(o, at_time);
  select * into row from public.orders where id = o;
  if answer is distinct from 'unchanged:paid' or row.status <> 'paid' or row.delivered_at is not null then
    raise exception 'FAIL 2c: an order that never shipped was marked delivered by tracking (answer %, status %)', answer, row.status;
  end if;

  o := pg_temp.new_order(buyer, seller, 'disputed', 'shipped');
  answer := public.order_mark_delivered_from_tracking(o, at_time);
  select * into row from public.orders where id = o;
  if answer is distinct from 'moved_in_case' or row.status <> 'disputed' or row.pre_dispute_status <> 'delivered' or row.delivered_at <> at_time then
    raise exception 'FAIL 2d: a delivery during an open case did not keep the case open and resolve to delivered (answer %)', answer;
  end if;
  -- A case on an order that had not shipped does not jump to delivered.
  o := pg_temp.new_order(buyer, seller, 'disputed', 'paid');
  answer := public.order_mark_delivered_from_tracking(o, at_time);
  select * into row from public.orders where id = o;
  if answer is distinct from 'unchanged:disputed' or row.pre_dispute_status <> 'paid' or row.delivered_at is not null then
    raise exception 'FAIL 2e: a case on an undispatched order was moved to delivered (answer %, before %)', answer, row.pre_dispute_status;
  end if;
  if public.order_mark_delivered_from_tracking(gen_random_uuid(), at_time) is not null then
    raise exception 'FAIL 2f: an order that does not exist did not answer null';
  end if;
  raise notice 'PASS 2: tracking marks a shipped order delivered once, and only a shipped one';

  -- ==========================================================
  -- 3. A dispute closed without a refund
  -- ==========================================================
  o := pg_temp.new_order(buyer, seller, 'disputed', 'shipped');
  update public.orders set refund_offer_cents = 2500, refund_offered_at = now(), refund_offer_expires_at = now() + interval '2 days' where id = o;

  answer := public.order_close_dispute(o, 'closed_by_buyer', at_time, other);
  select * into row from public.orders where id = o;
  if answer is not null or row.status <> 'disputed' or row.dispute_outcome is not null or row.refund_offer_cents is distinct from 2500 then
    raise exception 'FAIL 3a: somebody else closed a buyer''s dispute (answer %, status %)', answer, row.status;
  end if;

  answer := public.order_close_dispute(o, 'closed_by_buyer', at_time, buyer);
  select * into row from public.orders where id = o;
  if answer is distinct from 'shipped' or row.status <> 'shipped' or row.dispute_outcome <> 'closed_by_buyer'
     or row.dispute_resolved_at <> at_time or row.refund_offer_cents is not null or row.refund_offered_at is not null then
    raise exception 'FAIL 3b: the buyer''s close did not restore the order and withdraw the offer (answer %, status %, outcome %)', answer, row.status, row.dispute_outcome;
  end if;
  if public.order_close_dispute(o, 'closed_by_buyer', at_time + interval '1 hour', buyer) is not null then
    raise exception 'FAIL 3c: a settled dispute was closed a second time';
  end if;
  select * into row from public.orders where id = o;
  if row.dispute_resolved_at <> at_time then raise exception 'FAIL 3c: the second close changed the first one''s time'; end if;

  o := pg_temp.new_order(buyer, seller, 'disputed', 'delivered');
  answer := public.order_close_dispute(o, 'admin_resolved', at_time);
  select * into row from public.orders where id = o;
  if answer is distinct from 'delivered' or row.status <> 'delivered' or row.dispute_outcome <> 'admin_resolved' or row.dispute_resolved_at <> at_time then
    raise exception 'FAIL 3d: support''s resolution did not restore the order (answer %, status %)', answer, row.status;
  end if;

  -- The fix: the application read the earlier status, then wrote it back in a
  -- second statement. A delivery recorded between the two moved the earlier
  -- status to 'delivered', and the write then put the older 'shipped' back.
  -- Here: a case on a shipped order, the parcel is delivered while the case is
  -- open, then the buyer closes it. The order is delivered, with that date.
  o := pg_temp.new_order(buyer, seller, 'disputed', 'shipped');
  if public.order_mark_delivered_from_tracking(o, at_time - interval '1 hour') is distinct from 'moved_in_case' then
    raise exception 'FAIL 3k: the delivery during the case was not recorded';
  end if;
  answer := public.order_close_dispute(o, 'closed_by_buyer', at_time, buyer);
  select * into row from public.orders where id = o;
  if answer is distinct from 'delivered' or row.status <> 'delivered' or row.delivered_at <> at_time - interval '1 hour' then
    raise exception 'FAIL 3k: closing a dispute overwrote a delivery recorded during it (answer %, status %)', answer, row.status;
  end if;

  -- No status recorded before the dispute: 'delivered', as the application chose.
  o := pg_temp.new_order(buyer, seller, 'disputed', null);
  answer := public.order_close_dispute(o, 'admin_resolved', at_time);
  if answer is distinct from 'delivered' then raise exception 'FAIL 3e: a dispute with no earlier status resolved to % and not delivered', answer; end if;

  o := pg_temp.new_order(buyer, seller, 'paid');
  if public.order_close_dispute(o, 'admin_resolved', at_time) is not null then
    raise exception 'FAIL 3f: an order that is not in dispute was "resolved"';
  end if;
  select * into row from public.orders where id = o;
  if row.status <> 'paid' or row.dispute_outcome is not null then raise exception 'FAIL 3f: an order that is not in dispute was changed'; end if;

  o := pg_temp.new_order(buyer, seller, 'disputed', 'paid');
  rejected := false;
  begin perform public.order_close_dispute(o, 'admin_refunded', at_time); exception when others then rejected := true; end;
  if not rejected then raise exception 'FAIL 3g: an outcome that moves money was accepted by the no-refund close'; end if;
  rejected := false;
  begin perform public.order_close_dispute(o, 'closed_by_buyer', at_time); exception when others then rejected := true; end;
  if not rejected then raise exception 'FAIL 3h: closed_by_buyer was accepted without the buyer'; end if;
  rejected := false;
  begin perform public.order_close_dispute(o, 'admin_resolved', at_time, buyer); exception when others then rejected := true; end;
  if not rejected then raise exception 'FAIL 3i: admin_resolved was accepted with a buyer named'; end if;
  select * into row from public.orders where id = o;
  if row.status <> 'disputed' then raise exception 'FAIL 3j: a refused close changed the order'; end if;
  raise notice 'PASS 3: a dispute closes without a refund for its own buyer or for support, once, back to the status before it';

  -- ==========================================================
  -- 4. Server only
  -- ==========================================================
  foreach fn in array array[
    'public.order_mark_shipped_from_tracking(uuid,timestamptz,text,text)',
    'public.order_mark_delivered_from_tracking(uuid,timestamptz)',
    'public.order_close_dispute(uuid,text,timestamptz,uuid)'
  ] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute')
       or exists (select 1 from aclexplode((select proacl from pg_proc where oid = fn::regprocedure)) a where a.grantee = 0) then
      raise exception 'FAIL 4a: % is reachable by a client or through PUBLIC', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception 'FAIL 4b: the server cannot call %', fn;
    end if;
    if not (select prosecdef from pg_proc where oid = fn::regprocedure) then
      raise exception 'FAIL 4c: % does not run with its owner''s rights', fn;
    end if;
  end loop;

  -- And it works when the server, not the database owner, is the caller.
  o := pg_temp.new_order(buyer, seller, 'paid');
  perform set_config('role', 'service_role', true);
  answer := public.order_mark_shipped_from_tracking(o, at_time, 'UPS', '1ZSERVER');
  perform set_config('role', 'supabase_admin', true);
  if answer is distinct from 'moved' then raise exception 'FAIL 4d: the server''s call did not move the order (answer %)', answer; end if;
  raise notice 'PASS 4: the three functions are closed to clients and to PUBLIC, and the server can call them';

  -- ==========================================================
  -- 5. The payout-deadline fence holds inside the functions
  -- ==========================================================
  o := pg_temp.new_order(buyer, seller, 'paid');
  insert into private.payout_deadline_cancellations(order_id, seller_id) values (o, seller);
  rejected := false;
  begin perform public.order_mark_shipped_from_tracking(o, at_time, 'UPS', '1ZCLAIMED');
  exception when sqlstate 'LS002' then rejected := true; end;
  select * into row from public.orders where id = o;
  if not rejected or row.status <> 'paid' or row.shipped_at is not null then
    raise exception 'FAIL 5a: tracking marked a claimed order shipped (refused %, status %)', rejected, row.status;
  end if;

  o := pg_temp.new_order(buyer, seller, 'shipped');
  insert into private.payout_deadline_cancellations(order_id, seller_id) values (o, seller);
  rejected := false;
  begin perform public.order_mark_delivered_from_tracking(o, at_time);
  exception when sqlstate 'LS002' then rejected := true; end;
  select * into row from public.orders where id = o;
  if not rejected or row.status <> 'shipped' or row.delivered_at is not null then
    raise exception 'FAIL 5b: tracking marked a claimed order delivered (refused %, status %)', rejected, row.status;
  end if;

  -- A claimed order in an open case: the case's resolution does not move either.
  o := pg_temp.new_order(buyer, seller, 'disputed', 'paid');
  insert into private.payout_deadline_cancellations(order_id, seller_id) values (o, seller);
  rejected := false;
  begin perform public.order_mark_shipped_from_tracking(o, at_time, 'UPS', '1ZCLAIMEDCASE');
  exception when sqlstate 'LS002' then rejected := true; end;
  select * into row from public.orders where id = o;
  if not rejected or row.pre_dispute_status <> 'paid' then
    raise exception 'FAIL 5c: tracking moved a claimed order''s case to shipped (refused %, before %)', rejected, row.pre_dispute_status;
  end if;
  raise notice 'PASS 5: an order the payout deadline claimed is not marked shipped or delivered through the functions';

  -- ==========================================================
  -- 6. A card dispute opened, and won, are still the database's
  -- ==========================================================
  o := pg_temp.new_order(buyer, seller, 'shipped');
  insert into public.payments(order_id, provider, provider_reference, status, amount_cents, currency)
  values (o, 'stripe', 'pi_moves_guard', 'succeeded', 10000, 'USD');
  answer := public.apply_stripe_dispute_event('dp_moves_guard', 'pi_moves_guard', 10000, 'usd', 'needs_response', false, 'evt_moves_open', 100, lease);
  select * into row from public.orders where id = o;
  if answer is distinct from 'committed' or row.status <> 'disputed' or row.pre_dispute_status <> 'shipped' then
    raise exception 'FAIL 6a: a card dispute being opened did not move the order to disputed (answer %, status %, before %)', answer, row.status, row.pre_dispute_status;
  end if;
  answer := public.apply_stripe_dispute_event('dp_moves_guard', 'pi_moves_guard', 10000, 'usd', 'won', true, 'evt_moves_won', 110, lease);
  select * into row from public.orders where id = o;
  if answer is distinct from 'committed' or row.status <> 'shipped' or row.dispute_resolved_at is null then
    raise exception 'FAIL 6b: a card dispute being won did not return the order to shipped (answer %, status %)', answer, row.status;
  end if;
  raise notice 'PASS 6: a card dispute opened and a card dispute won still move the order, through apply_stripe_dispute_event';

  raise notice 'all order status move checks passed';
end $$;

rollback;
