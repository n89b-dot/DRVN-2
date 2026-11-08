-- The charge.refunded gap from one snapshot (20261107210150; OS-W20
-- follow-up to #91). refund_gap_snapshot returns a payment's booked refund
-- total and the cents of the listed refunds whose operation is still booking,
-- from one statement, so a refund that settles at any moment is counted in
-- exactly one of the two. Disposable database only; everything rolls back.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  o uuid;
  s jsonb;
  inflight uuid;
begin
  insert into auth.users(id, email) values (seller, 'w20f-seller@example.test'), (buyer, 'w20f-buyer@example.test');
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'delivered', 10000, 1000, 10000, 'USD') returning id into o;
  insert into public.payments(order_id, provider, provider_reference, status, amount_cents, currency, refunded_cents)
  values (o, 'stripe', 'pi_w20f', 'partially_refunded', 10000, 'USD', 1000);

  -- One refund still booking, one the provider refused, one not listed.
  insert into public.refund_operations(order_id, payment_reference, amount_cents, currency, remaining_before_cents, reason,
    requested_by, actor_role, idempotency_key, status, refund_reference)
  values (o, 'pi_w20f', 3000, 'USD', 9000, 'guard: booking', 'guard', 'system', 'w20f-booking', 'provider_pending', 're_w20f_booking')
  returning id into inflight;
  insert into public.refund_operations(order_id, payment_reference, amount_cents, currency, remaining_before_cents, reason,
    requested_by, actor_role, idempotency_key, status, refund_reference)
  values (o, 'pi_w20f', 500, 'USD', 6000, 'guard: refused', 'guard', 'system', 'w20f-refused', 'failed', 're_w20f_refused'),
         (o, 'pi_w20f', 700, 'USD', 6000, 'guard: other', 'guard', 'system', 'w20f-other', 'provider_pending', 're_w20f_other');

  s := public.refund_gap_snapshot('pi_w20f', array['re_w20f_booking', 're_w20f_refused']);
  if (s->>'booked_cents')::int <> 1000 or (s->>'in_flight_cents')::int <> 3000 or (s->>'payments')::int <> 1 then
    raise exception 'FAIL 1: unexpected snapshot %', s;
  end if;
  raise notice 'PASS 1: booked total and only the listed, still-booking refunds';

  -- The refund books: refunded_cents and the operation move in one
  -- transaction, so the snapshot moves the cents from one side to the other.
  update public.payments set refunded_cents = refunded_cents + 3000 where order_id = o;
  update public.refund_operations set effects_completed_at = now() where id = inflight;
  s := public.refund_gap_snapshot('pi_w20f', array['re_w20f_booking', 're_w20f_refused']);
  if (s->>'booked_cents')::int <> 4000 or (s->>'in_flight_cents')::int <> 0 then
    raise exception 'FAIL 2: a booked refund is not counted as booked (%)', s;
  end if;
  raise notice 'PASS 2: once booked, the refund is booked, not in flight';

  s := public.refund_gap_snapshot('pi_w20f_unknown', null);
  if (s->>'booked_cents')::int <> 0 or (s->>'in_flight_cents')::int <> 0 or (s->>'payments')::int <> 0 then
    raise exception 'FAIL 3: unknown payment snapshot %', s;
  end if;
  raise notice 'PASS 3: an unknown payment reads as nothing';

  if has_function_privilege('authenticated', 'public.refund_gap_snapshot(text,text[])', 'execute')
     or has_function_privilege('anon', 'public.refund_gap_snapshot(text,text[])', 'execute')
     or not has_function_privilege('service_role', 'public.refund_gap_snapshot(text,text[])', 'execute') then
    raise exception 'FAIL 4: the snapshot is callable by a client role, or not by the service role';
  end if;
  raise notice 'PASS 4: service role only';

  raise notice 'all refund gap snapshot checks passed';
end $$;

rollback;
