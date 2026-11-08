-- OS-W17: a buyer restarting their own unconfirmed cart checkout releases
-- exactly that basket, and nothing that has been (or may be) paid.
-- Disposable local DB only.
begin;

do $$
<<cart_checkout_release_guard>>
declare
  seller_id uuid := gen_random_uuid();
  buyer_id uuid := gen_random_uuid();
  other_buyer_id uuid := gen_random_uuid();
  listing_a uuid;
  listing_b uuid;
  order_id uuid;
  begun jsonb;
  released jsonb;
  restarted jsonb;
  rejected boolean;
  context jsonb := jsonb_build_object(
    'version', 1,
    'shipping', jsonb_build_object('name', 'Buyer', 'line1', '1 Main', 'city', 'Detroit', 'postcode', '48201', 'country', 'US', 'isCollection', false),
    'destinationHash', 'destination-hash',
    'quoteIds', '{}'::jsonb
  );
begin
  if to_regprocedure('public.release_cart_checkout(uuid,text,text)') is null then
    raise exception 'FAIL: release_cart_checkout contract is missing';
  end if;
  if has_function_privilege('authenticated', 'public.release_cart_checkout(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.release_cart_checkout(uuid,text,text)', 'EXECUTE') then
    raise exception 'FAIL: a client role can release checkouts';
  end if;

  insert into auth.users (id, email) values
    (seller_id, 'release-seller@example.test'),
    (buyer_id, 'release-buyer@example.test'),
    (other_buyer_id, 'release-other@example.test');
  update public.profiles set username = 'release_seller' where id = seller_id;
  update public.profiles set username = 'release_buyer' where id = buyer_id;
  update public.profiles set username = 'release_other' where id = other_buyer_id;

  insert into public.listings (seller_id, title, category, price_cents, shipping_cents, status, currency)
  values (seller_id, 'Release intercooler', 'engine', 25000, 1200, 'active', 'USD')
  returning id into listing_a;
  insert into public.listings (seller_id, title, category, price_cents, shipping_cents, status, currency)
  values (seller_id, 'Release downpipe', 'engine', 18000, 900, 'active', 'USD')
  returning id into listing_b;

  begun := public.purchase_begin(
    buyer_id, array[listing_a, listing_b], 'release-key-1', interval '15 minutes',
    '{}'::jsonb, 'release-browser-1', context
  );
  order_id := (begun -> 'orders' -> 0 ->> 'order_id')::uuid;
  perform public.bind_cart_checkout_payment(buyer_id, 'release-key-1', array[order_id], 'stripe', 'pi_release_1');

  -- Another buyer cannot release it.
  rejected := false;
  begin
    perform public.release_cart_checkout(other_buyer_id, 'release-key-1', 'pi_release_1');
  exception when sqlstate '42501' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: another buyer released the checkout'; end if;

  -- A different provider reference cannot release it.
  rejected := false;
  begin
    perform public.release_cart_checkout(buyer_id, 'release-key-1', 'pi_someone_else');
  exception when sqlstate '55000' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a mismatched payment reference released the checkout'; end if;

  -- Without a reference while one is mapped, the outcome is unresolved.
  rejected := false;
  begin
    perform public.release_cart_checkout(buyer_id, 'release-key-1', null);
  exception when sqlstate '55000' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: released a mapped intent without its reference'; end if;

  if (select count(*) from public.listings where id in (listing_a, listing_b) and status = 'reserved') <> 2 then
    raise exception 'FAIL: a refused release changed the reservation';
  end if;

  released := public.release_cart_checkout(buyer_id, 'release-key-1', 'pi_release_1');
  if released ->> 'ok' <> 'true' or (released ->> 'released')::int <> 1 then
    raise exception 'FAIL: the buyer''s own unconfirmed checkout was not released: %', released;
  end if;
  if (select status from public.orders where id = order_id) <> 'payment_failed' then
    raise exception 'FAIL: the released order is not closed';
  end if;
  if (select count(*) from public.listings where id in (listing_a, listing_b) and status = 'active' and reserved_until is null) <> 2 then
    raise exception 'FAIL: released parts are not back on sale';
  end if;
  if (select status from public.payments where payments.order_id = cart_checkout_release_guard.order_id) <> 'failed' then
    raise exception 'FAIL: the released payment row is still open';
  end if;

  -- Releasing again is a no-op, not an error.
  released := public.release_cart_checkout(buyer_id, 'release-key-1', 'pi_release_1');
  if (released ->> 'released')::int <> 0 then
    raise exception 'FAIL: a repeated release did something: %', released;
  end if;

  -- The restarted checkout can reserve the same parts again.
  restarted := public.purchase_begin(
    buyer_id, array[listing_a, listing_b], 'release-key-2', interval '15 minutes',
    '{}'::jsonb, 'release-browser-2', context
  );
  if jsonb_array_length(restarted -> 'orders') <> 1 or jsonb_array_length(restarted -> 'skipped') <> 0 then
    raise exception 'FAIL: the restarted checkout could not reserve the released parts: %', restarted;
  end if;

  -- A paid checkout is never released.
  order_id := (restarted -> 'orders' -> 0 ->> 'order_id')::uuid;
  perform public.bind_cart_checkout_payment(buyer_id, 'release-key-2', array[order_id], 'stripe', 'pi_release_2');
  perform public.purchase_finalize(order_id, true, 'stripe', 'pi_release_2');
  rejected := false;
  begin
    perform public.release_cart_checkout(buyer_id, 'release-key-2', 'pi_release_2');
  exception when sqlstate '55000' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: a paid checkout was released'; end if;
  if (select status from public.orders where id = order_id) <> 'paid'
     or (select count(*) from public.listings where id in (listing_a, listing_b) and status = 'sold') <> 2 then
    raise exception 'FAIL: a refused release changed a paid order';
  end if;

  raise notice 'PASS: only the buyer''s own unconfirmed checkout is released, and the parts can be reserved again';
end;
$$;

rollback;

select 'all cart checkout release checks passed' as result;
