-- The console's 7-day money tiles are summed in the database, not over a
-- PostgREST page capped at max_rows (20261004131000).
begin;
do $$
declare
  buyer uuid := gen_random_uuid();
  seller uuid := gen_random_uuid();
  w jsonb;
  since timestamptz := now() - interval '7 days';
begin
  insert into auth.users(id, email) values
    (buyer, 'money-window-buyer@example.test'), (seller, 'money-window-seller@example.test');
  -- Leave only this test's rows in the window so the sums are exact.
  perform set_config('session_replication_role', 'replica', true);
  delete from public.orders where created_at >= since or refunded_at >= since;

  -- 1,200 paid orders: more than one PostgREST page.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  select buyer, seller, 'paid', 1000, 100, 1000, 'USD' from generate_series(1, 1200);
  -- Unpaid checkouts are not GMV.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (buyer, seller, 'pending', 5000, 500, 5000, 'USD'),
         (buyer, seller, 'payment_failed', 5000, 500, 5000, 'USD');
  -- A refund inside the window, on an order from before it.
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency,
                            refunded_cents, platform_fee_refunded_cents, refunded_at, created_at)
  values (buyer, seller, 'refunded', 3000, 300, 3000, 'USD', 3000, 300, now(), now() - interval '20 days');
  perform set_config('session_replication_role', 'origin', true);

  w := public.admin_order_money_window(since, now() + interval '1 minute');
  if (w->>'orders')::int <> 1200
     or (w->>'gmv_cents')::bigint <> 1200000
     or (w->>'fee_cents')::bigint <> 120000
     or (w->>'refunded_cents')::bigint <> 3000
     or (w->>'fee_refunded_cents')::bigint <> 300 then
    raise exception 'Money window sums are wrong: %', w;
  end if;

  w := public.admin_order_money_window(now() - interval '14 days', since);
  if (w->>'orders')::int <> 0 or (w->>'refunded_cents')::bigint <> 0 then
    raise exception 'The previous window counted this week''s orders: %', w;
  end if;

  if has_function_privilege('anon', 'public.admin_order_money_window(timestamptz,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.admin_order_money_window(timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'Clients can read platform money totals';
  end if;

  raise notice 'admin_money_window_guard: all checks passed';
end $$;
rollback;
