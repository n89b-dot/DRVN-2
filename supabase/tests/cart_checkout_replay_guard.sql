-- Durable authenticated cart-checkout replay guard. Disposable local DB only.
begin;

do $$
<<cart_checkout_replay_guard>>
declare
  seller_id uuid := gen_random_uuid();
  buyer_id uuid := gen_random_uuid();
  other_buyer_id uuid := gen_random_uuid();
  listing_id uuid;
  order_id uuid;
  unrelated_order_id uuid := gen_random_uuid();
  first_result jsonb;
  replay_result jsonb;
  rejected boolean := false;
begin
  if to_regprocedure('public.purchase_begin(uuid,uuid[],text,interval,jsonb)') is not null then
    raise exception 'FAIL: obsolete five-argument purchase_begin overload remains callable';
  end if;
  if to_regprocedure('public.purchase_begin(uuid,uuid[],text,interval,jsonb,text)') is not null then
    raise exception 'FAIL: obsolete six-argument purchase_begin overload remains callable';
  end if;
  if to_regprocedure('public.purchase_begin(uuid,uuid[],text,interval,jsonb,text,jsonb)') is null then
    raise exception 'FAIL: seven-argument purchase_begin contract is missing';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.purchase_begin(uuid,uuid[],text,interval,jsonb,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated role can execute the service-only purchase RPC';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.bind_cart_checkout_payment(uuid,text,uuid[],text,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated role can bind checkout payment references';
  end if;

  insert into auth.users (id, email) values
    (seller_id, 'cart-replay-seller@example.test'),
    (buyer_id, 'cart-replay-buyer@example.test'),
    (other_buyer_id, 'cart-replay-other@example.test');

  update public.profiles set username = 'cart_replay_seller' where id = seller_id;
  update public.profiles set username = 'cart_replay_buyer' where id = buyer_id;
  update public.profiles set username = 'cart_replay_other' where id = other_buyer_id;

  insert into public.listings
    (seller_id, title, category, price_cents, shipping_cents, status, currency)
  values
    (seller_id, 'Replay-bound intercooler', 'engine', 25000, 1200, 'active', 'USD')
  returning id into listing_id;

  first_result := public.purchase_begin(
    buyer_id,
    array[listing_id],
    'cart-replay-payment-key',
    interval '15 minutes',
    jsonb_build_object(listing_id::text, 1350),
    'cart-replay-browser-key',
    jsonb_build_object(
      'version', 1,
      'shipping', jsonb_build_object('name', 'Buyer', 'line1', '1 Main', 'city', 'Detroit', 'postcode', '48201', 'country', 'US', 'isCollection', false),
      'destinationHash', 'destination-hash',
      'quoteIds', '{}'::jsonb
    )
  );

  if jsonb_array_length(first_result -> 'orders') <> 1 then
    raise exception 'FAIL: initial bound checkout did not create one order: %', first_result;
  end if;
  order_id := (first_result -> 'orders' -> 0 ->> 'order_id')::uuid;
  if not exists (
    select 1 from public.purchase_attempts
    where checkout_request_key = 'cart-replay-browser-key'
      and idempotency_key = 'cart-replay-payment-key'
      and purchase_attempts.buyer_id = cart_checkout_replay_guard.buyer_id
  ) then
    raise exception 'FAIL: browser request was not bound to its buyer and payment key';
  end if;

  -- The listing is reserved now. Exact replay must return the stored result
  -- instead of checking current listing availability or creating another order.
  replay_result := public.purchase_begin(
    buyer_id,
    array[listing_id],
    'cart-replay-payment-key',
    interval '15 minutes',
    jsonb_build_object(listing_id::text, 1350),
    'cart-replay-browser-key',
    jsonb_build_object(
      'version', 1,
      'shipping', jsonb_build_object('name', 'Buyer', 'line1', '1 Main', 'city', 'Detroit', 'postcode', '48201', 'country', 'US', 'isCollection', false),
      'destinationHash', 'destination-hash',
      'quoteIds', '{}'::jsonb
    )
  );
  if replay_result is distinct from first_result then
    raise exception 'FAIL: exact browser-bound replay changed the result';
  end if;
  if (select count(*) from public.orders where orders.buyer_id = cart_checkout_replay_guard.buyer_id) <> 1 then
    raise exception 'FAIL: exact replay created another order';
  end if;

  rejected := false;
  begin
    perform public.purchase_begin(
      buyer_id,
      array[listing_id],
      'cart-replay-payment-key',
      interval '15 minutes',
      jsonb_build_object(listing_id::text, 1350),
      'cart-replay-browser-key',
      jsonb_build_object(
        'version', 1,
        'shipping', jsonb_build_object('name', 'Buyer', 'line1', '1 Main', 'city', 'Detroit', 'postcode', '48201', 'country', 'US', 'isCollection', false),
        'destinationHash', 'destination-hash',
        'quoteIds', jsonb_build_object(listing_id::text, gen_random_uuid()::text)
      )
    );
  exception when sqlstate '42501' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'FAIL: bound checkout accepted a changed shipping service selection';
  end if;

  rejected := false;
  begin
    perform public.purchase_begin(
      buyer_id,
      array[listing_id],
      'changed-payment-key',
      interval '15 minutes',
      jsonb_build_object(listing_id::text, 1350),
      'cart-replay-browser-key',
      jsonb_build_object(
        'version', 1,
        'shipping', jsonb_build_object('name', 'Buyer', 'line1', '1 Main', 'city', 'Detroit', 'postcode', '48201', 'country', 'US', 'isCollection', false),
        'destinationHash', 'destination-hash',
        'quoteIds', '{}'::jsonb
      )
    );
  exception when sqlstate '42501' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'FAIL: one browser key rebound to a different payment request';
  end if;

  rejected := false;
  begin
    perform public.purchase_begin(
      other_buyer_id,
      array[listing_id],
      'cart-replay-payment-key',
      interval '15 minutes',
      jsonb_build_object(listing_id::text, 1350),
      'cart-replay-browser-key',
      jsonb_build_object(
        'version', 1,
        'shipping', jsonb_build_object('name', 'Buyer', 'line1', '1 Main', 'city', 'Detroit', 'postcode', '48201', 'country', 'US', 'isCollection', false),
        'destinationHash', 'destination-hash',
        'quoteIds', '{}'::jsonb
      )
    );
  exception when sqlstate '42501' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'FAIL: another buyer adopted the browser-bound checkout';
  end if;

  rejected := false;
  begin
    perform public.purchase_begin(
      buyer_id,
      array[listing_id],
      null,
      interval '15 minutes',
      '{}'::jsonb,
      'unpersistable-browser-key',
      '{}'::jsonb
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'FAIL: a browser binding without a durable idempotency key was accepted';
  end if;

  perform public.bind_cart_checkout_payment(
    buyer_id,
    'cart-replay-payment-key',
    array[order_id],
    'stripe',
    'pi_cart_replay'
  );
  if not exists (
    select 1 from public.payments
    where payments.order_id = cart_checkout_replay_guard.order_id
      and provider = 'stripe'
      and provider_reference = 'pi_cart_replay'
  ) then
    raise exception 'FAIL: provider reference was not bound to the basket payment';
  end if;

  rejected := false;
  begin
    perform public.bind_cart_checkout_payment(
      buyer_id,
      'cart-replay-payment-key',
      array[order_id],
      'stripe',
      'pi_conflicting_reference'
    );
  exception when sqlstate '23505' then
    rejected := true;
  end;
  if not rejected or exists (
    select 1 from public.payments
    where payments.order_id = cart_checkout_replay_guard.order_id
      and provider_reference = 'pi_conflicting_reference'
  ) then
    raise exception 'FAIL: conflicting provider reference replaced the durable mapping';
  end if;

  rejected := false;
  begin
    perform public.bind_cart_checkout_payment(
      buyer_id,
      'cart-replay-payment-key',
      array[order_id],
      'different-provider',
      'pi_cart_replay'
    );
  exception when sqlstate '23505' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'FAIL: a conflicting provider adopted the existing reference';
  end if;

  insert into public.orders(
    id, buyer_id, seller_id, status, subtotal_cents, shipping_cents,
    platform_fee_cents, total_cents, currency
  ) values(
    unrelated_order_id, buyer_id, seller_id, 'pending', 100, 0, 10, 100, 'USD'
  );
  rejected := false;
  begin
    perform public.bind_cart_checkout_payment(
      buyer_id,
      'cart-replay-payment-key',
      array[order_id, unrelated_order_id],
      'stripe',
      'pi_cart_replay'
    );
  exception when sqlstate '42501' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'FAIL: payment binding accepted an order outside its durable attempt';
  end if;

  raise notice 'PASS: exact replay survives reserved listings and binding refuses changed payment or buyer';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);

do $$
declare
  denied boolean := false;
begin
  begin
    perform public.purchase_begin(
      gen_random_uuid(),
      array[]::uuid[],
      'client-payment-key',
      interval '15 minutes',
      '{}'::jsonb,
      'client-browser-key',
      '{}'::jsonb
    );
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then
    raise exception 'FAIL: authenticated client called the service-only purchase RPC';
  end if;

  begin
    perform 1 from public.purchase_attempts limit 1;
    raise exception 'FAIL: authenticated client read private purchase attempts';
  exception when insufficient_privilege then
    null;
  end;

  raise notice 'PASS: browser bindings and purchase attempts remain service-only';
end;
$$;

reset role;
rollback;

select 'all cart checkout replay checks passed' as result;
