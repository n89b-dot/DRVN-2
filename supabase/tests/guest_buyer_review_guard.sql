-- 20261005101000: a seller can review a buyer only on an order that buyer
-- placed with a proven address — never on a guest checkout someone else may
-- have typed their email into.
begin;
create function pg_temp.impersonate(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
$$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (architecture plan 2, item A3), so they are opened here.
grant execute on all routines in schema pg_temp to public;
do $$
declare
  member uuid := gen_random_uuid();   -- signed in, confirmed address
  guest uuid := gen_random_uuid();    -- created by guest checkout, never confirmed
  seller uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  member_order uuid; guest_order uuid; claimed_order uuid;
  refused boolean;
begin
  insert into auth.users(id, email, confirmed_at) values
    (member, 'unproven-guard-member@example.test', now() - interval '1 day'),
    (guest, 'unproven-guard-guest@example.test', null),
    (seller, 'unproven-guard-seller@example.test', now() - interval '1 day'),
    (outsider, 'unproven-guard-outsider@example.test', now() - interval '1 day');

  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (member, seller, 'delivered', 1000, 100, 1000, 'USD') returning id into member_order;
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (guest, seller, 'delivered', 1000, 100, 1000, 'USD') returning id into guest_order;

  if exists(select 1 from private.unproven_buyer_orders where order_id = member_order) then raise exception 'A signed-in member''s order was recorded as a guest order'; end if;
  if not exists(select 1 from private.unproven_buyer_orders where order_id = guest_order and buyer_id = guest) then raise exception 'A guest order was not recorded'; end if;

  -- Claiming the account later doesn't make the earlier order reviewable;
  -- orders placed after the claim are ordinary.
  update auth.users set confirmed_at = now() where id = guest;
  insert into public.orders(buyer_id, seller_id, status, subtotal_cents, platform_fee_cents, total_cents, currency)
  values (guest, seller, 'delivered', 1000, 100, 1000, 'USD') returning id into claimed_order;
  if not exists(select 1 from private.unproven_buyer_orders where order_id = guest_order) then raise exception 'A claim erased the guest-order record'; end if;
  if exists(select 1 from private.unproven_buyer_orders where order_id = claimed_order) then raise exception 'An order placed after the claim was recorded as a guest order'; end if;

  -- The seller cannot review the buyer of the guest order…
  perform pg_temp.impersonate(seller);
  refused := false;
  begin
    insert into public.reviews(order_id, reviewer_id, reviewee_id, rating, body) values (guest_order, seller, guest, 1, 'smear');
  exception when insufficient_privilege then
    if sqlerrm not like '%checked out as a guest%' then raise; end if;
    refused := true;
  end;
  if not refused then raise exception 'Seller reviewed a guest-checkout buyer'; end if;
  -- …but can review buyers who signed in, including after a claim.
  insert into public.reviews(order_id, reviewer_id, reviewee_id, rating, body) values (member_order, seller, member, 5, 'smooth buyer');
  insert into public.reviews(order_id, reviewer_id, reviewee_id, rating, body) values (claimed_order, seller, guest, 5, 'smooth buyer');

  if public.order_buyer_reviewable(guest_order) is distinct from false then raise exception 'order_buyer_reviewable offered a guest order'; end if;
  if public.order_buyer_reviewable(member_order) is distinct from true then raise exception 'order_buyer_reviewable refused a member order'; end if;
  perform pg_temp.impersonate(outsider);
  if public.order_buyer_reviewable(guest_order) is not null then raise exception 'order_buyer_reviewable answered a non-party'; end if;

  -- The guest buyer, once they hold the account, can still review the seller.
  perform pg_temp.impersonate(guest);
  insert into public.reviews(order_id, reviewer_id, reviewee_id, rating, body) values (guest_order, guest, seller, 4, 'fine seller');

  -- No writer bypasses it: the service role is refused too.
  perform set_config('role', 'service_role', true);
  refused := false;
  begin
    insert into public.reviews(order_id, reviewer_id, reviewee_id, rating, body) values (guest_order, seller, guest, 1, 'smear via service role');
  exception when insufficient_privilege then refused := true;
  end;
  if not refused then raise exception 'Service role reviewed a guest-checkout buyer'; end if;
  perform set_config('role', 'none', true);

  if has_table_privilege('authenticated', 'private.unproven_buyer_orders', 'select') or has_table_privilege('anon', 'private.unproven_buyer_orders', 'select') then raise exception 'Guest-order records are client-readable'; end if;
  if has_function_privilege('anon', 'public.order_buyer_reviewable(uuid)', 'execute') then raise exception 'anon can call order_buyer_reviewable'; end if;
  raise notice 'all guest buyer review checks passed';
end $$;
rollback;
