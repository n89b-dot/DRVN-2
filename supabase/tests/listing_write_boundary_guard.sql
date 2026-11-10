-- The listing write boundary (20261107210000, OS-W16): a bypass matrix.
-- Every case is a member's own sign-in key calling the database directly,
-- as PostgREST would (role authenticated, the member's JWT claims), with no
-- app in front. Each rule the sell form checks must hold here too.
--
--   N69   column grants, frozen server fields, insert states, gallery /
--         fitment / part-number bounds, content frozen on a reserved
--         listing (20261107210050), a live listing keeps a photo
--   N244  payouts before going live (insert, publish, the creation RPC);
--         checkout skips or refuses a seller who can't be paid, including
--         one whose payouts lapsed after publishing; no new payment starts
--         for one whose payouts lapsed after an offer was accepted
--         (20261107210050); stub mode exempt. Since 20261108100000 the
--         rule is "setup started" (details submitted); this file's unpaid
--         seller never submitted details, so it is still refused here.
--         The new rule is payout_setup_started_guard.sql's.
--   N72   (claim rebinding is in listing_creation_request_guard.sql)
--   N71   a seller's own "Mark sold" doesn't count as a sale
--   N26   the settlement row is private; the hold policy projection is
--         public and carries no threshold
--
-- Deferred photo checks are fired with SET CONSTRAINTS ... IMMEDIATE while
-- the member's claims are still set, as a PostgREST commit would.
begin;

create function pg_temp.as_member(p_member uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_member, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.as_server() returns void language plpgsql as $$
begin
  perform set_config('role', 'supabase_admin', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (architecture plan 2, item A3), so they are opened here.
grant execute on all routines in schema pg_temp to public;

do $$
declare
  seller uuid := gen_random_uuid();
  unpaid uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  img text := 'https://proj.supabase.co/storage/v1/object/public/listing-images/' || seller || '/';
  unpaid_img text := 'https://proj.supabase.co/storage/v1/object/public/listing-images/' || unpaid || '/';
  draft uuid := gen_random_uuid();
  live uuid := gen_random_uuid();
  held uuid := gen_random_uuid();
  lapsed uuid := gen_random_uuid();
  other uuid;
  col text;
  result jsonb;
  policy record;
  rejected boolean;
  i integer;
  listing_payload jsonb;
  offered uuid := gen_random_uuid();
  offer_id uuid;
  offer_order uuid;
  prepared jsonb;
begin
  insert into public.job_config(key, value) values ('media_storage_origin', 'https://proj.supabase.co')
    on conflict (key) do update set value = excluded.value;
  -- No payments_mode row: the production default, payout readiness enforced.
  delete from public.job_config where key = 'payments_mode';

  insert into auth.users(id, email) values
    (seller, 'boundary-seller@drvn.test'),
    (unpaid, 'boundary-unpaid@drvn.test'),
    (buyer, 'boundary-buyer@drvn.test');
  update public.profiles set payouts_enabled = true where id = seller;

  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status) values
    (draft, seller, 'Boundary draft', 'performance', 5000, 0, 'draft'),
    (live, seller, 'Boundary live', 'performance', 5000, 0, 'active'),
    (held, seller, 'Boundary held', 'performance', 5000, 0, 'active');
  insert into public.listing_images(listing_id, url, position) values
    (live, img || 'live-1.webp', 0), (live, img || 'live-2.webp', 1), (held, img || 'held.webp', 0);
  update public.listings set status = 'reserved', reserved_until = now() + interval '15 minutes' where id = held;
  set constraints all immediate;
  set constraints all deferred;

  -- ==========================================================
  -- N69 1. Server-owned columns: no grant, so a direct write is refused
  -- ==========================================================
  perform pg_temp.as_member(seller);
  foreach col in array array['created_at', 'view_count', 'published_at', 'sold_at', 'reserved_until',
                             'removed_at', 'removed_reason', 'currency', 'updated_at', 'seller_id', 'id'] loop
    rejected := false;
    begin
      execute format(
        'update public.listings set %I = %s where id = $1', col,
        case col
          when 'view_count' then '9999'
          when 'currency' then '''USD'''
          when 'removed_reason' then '''x'''
          when 'seller_id' then quote_literal(buyer) || '::uuid'
          when 'id' then 'gen_random_uuid()'
          else '''2030-01-01'''::text
        end
      ) using draft;
    exception when insufficient_privilege then rejected := true;
    end;
    if not rejected then raise exception 'FAIL 1: a member updated listings.%', col; end if;
  end loop;
  foreach col in array array['created_at', 'view_count', 'published_at', 'sold_at', 'removed_at'] loop
    rejected := false;
    begin
      execute format(
        'insert into public.listings(seller_id, title, category, price_cents, status, %I) values ($1, ''Forged'', ''performance'', 5000, ''draft'', %s)',
        col, case col when 'view_count' then '9999' else '''2030-01-01''' end
      ) using seller;
    exception when insufficient_privilege then rejected := true;
    end;
    if not rejected then raise exception 'FAIL 1: a member inserted listings.%', col; end if;
  end loop;
  -- What a member may write still works.
  update public.listings set title = 'Boundary draft, renamed', price_cents = 6000 where id = draft;
  if not found then raise exception 'FAIL 1: a member could not edit their own draft'; end if;
  raise notice 'PASS 1: server-owned listing columns are not writable by a member';

  -- ==========================================================
  -- N69 2. A grant reopened by mistake is still caught by the freeze trigger
  -- ==========================================================
  perform pg_temp.as_server();
  grant update (view_count, created_at) on public.listings to authenticated;
  perform pg_temp.as_member(seller);
  rejected := false;
  begin
    update public.listings set view_count = 9999 where id = draft;
  exception when insufficient_privilege then rejected := sqlerrm like '%set by DRVN%';
  end;
  if not rejected then raise exception 'FAIL 2: the freeze trigger let view_count through'; end if;
  perform pg_temp.as_server();
  revoke update (view_count, created_at) on public.listings from authenticated;
  raise notice 'PASS 2: the freeze trigger holds server fields without the grants';

  -- ==========================================================
  -- N69 3. A new listing starts as a draft or live, never sold/reserved/removed
  -- ==========================================================
  perform pg_temp.as_member(seller);
  foreach col in array array['sold', 'reserved', 'removed', 'paused'] loop
    rejected := false;
    begin
      insert into public.listings(seller_id, title, category, price_cents, status)
      values (seller, 'Forged history', 'performance', 5000, col);
    exception when insufficient_privilege then rejected := true;
    end;
    if not rejected then raise exception 'FAIL 3: a member inserted a % listing', col; end if;
  end loop;
  raise notice 'PASS 3: a member cannot insert a sold, reserved, removed or paused listing';

  -- ==========================================================
  -- N69 4. A live listing needs a photo, whatever the path
  -- ==========================================================
  -- 4a. Insert straight to active, no photo.
  rejected := false;
  begin
    insert into public.listings(seller_id, title, category, price_cents, status)
    values (seller, 'No photo', 'performance', 5000, 'active');
    set constraints all immediate;
  exception when check_violation then rejected := true;
  end;
  set constraints all deferred;
  if not rejected then raise exception 'FAIL 4a: a live listing committed without a photo'; end if;
  -- 4b. Draft to active, no photo.
  rejected := false;
  begin
    update public.listings set status = 'active' where id = draft;
    set constraints all immediate;
  exception when check_violation then rejected := true;
  end;
  set constraints all deferred;
  if not rejected then raise exception 'FAIL 4b: a draft went live without a photo'; end if;
  -- 4c. Removing one of two photos is fine; removing the last is not.
  delete from public.listing_images where listing_id = live and url = img || 'live-2.webp';
  set constraints all immediate;
  set constraints all deferred;
  rejected := false;
  begin
    delete from public.listing_images where listing_id = live;
    set constraints all immediate;
  exception when check_violation then rejected := true;
  end;
  set constraints all deferred;
  if not rejected then raise exception 'FAIL 4c: a live listing lost its last photo'; end if;
  if not exists (select 1 from public.listing_images where listing_id = live) then
    raise exception 'FAIL 4c: the refused delete still removed the photo';
  end if;
  -- 4d. A draft with a photo goes live.
  insert into public.listing_images(listing_id, url, position) values (draft, img || 'draft.webp', 0);
  update public.listings set status = 'active' where id = draft;
  set constraints all immediate;
  set constraints all deferred;
  if (select status from public.listings where id = draft) <> 'active' then
    raise exception 'FAIL 4d: a draft with a photo did not go live';
  end if;
  update public.listings set status = 'paused' where id = draft;
  raise notice 'PASS 4: a member''s live listing always has a photo';

  -- ==========================================================
  -- N69 5. Gallery, fitment and part numbers are bounded and frozen while held
  -- ==========================================================
  insert into public.listings(id, seller_id, title, category, price_cents, status)
  values (gen_random_uuid(), seller, 'Gallery cap', 'performance', 5000, 'draft') returning id into other;
  for i in 1..12 loop
    insert into public.listing_images(listing_id, url, position) values (other, img || 'cap-' || i || '.webp', i - 1);
  end loop;
  rejected := false;
  begin
    insert into public.listing_images(listing_id, url, position) values (other, img || 'cap-13.webp', 12);
  exception when program_limit_exceeded then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 5: a 13th photo was added'; end if;
  for i in 1..10 loop
    insert into public.listing_fitments(listing_id, make, model) values (other, 'Audi', 'S' || i);
  end loop;
  rejected := false;
  begin
    insert into public.listing_fitments(listing_id, make, model) values (other, 'Audi', 'S11');
  exception when program_limit_exceeded then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 5: an 11th fitment row was added'; end if;
  for i in 1..5 loop
    insert into public.listing_part_numbers(listing_id, number) values (other, 'PN-' || i);
  end loop;
  rejected := false;
  begin
    insert into public.listing_part_numbers(listing_id, number) values (other, 'PN-6');
  exception when program_limit_exceeded then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 5: a 6th part number was added'; end if;
  -- Nothing on a reserved listing changes under the buyer.
  rejected := false;
  begin
    insert into public.listing_images(listing_id, url, position) values (held, img || 'swap.webp', 1);
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 5: a photo was added to a reserved listing'; end if;
  rejected := false;
  begin
    update public.listing_images set alt = 'Different part' where listing_id = held;
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 5: a reserved listing''s photo was changed'; end if;
  rejected := false;
  begin
    insert into public.listing_fitments(listing_id, make, model) values (held, 'BMW', 'M3');
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 5: fitment was added to a reserved listing'; end if;
  -- A photo row can't be moved to another listing, nor its id rewritten.
  rejected := false;
  begin
    update public.listing_images set listing_id = draft where listing_id = other;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 5: a photo was moved between listings'; end if;
  -- The listing row itself: a seller's own content fields are frozen too,
  -- not only price and shipping (20261107210050).
  foreach col in array array['title', 'description', 'condition', 'brand', 'location', 'compatibility_notes',
                             'part_number', 'grade', 'allows_collection', 'show_offer_floor'] loop
    rejected := false;
    begin
      execute format(
        'update public.listings set %I = %s where id = $1', col,
        case col
          when 'condition' then '''for_parts'''
          when 'grade' then '''c'''
          when 'allows_collection' then 'not allows_collection'
          when 'show_offer_floor' then 'not show_offer_floor'
          else '''Swapped under the buyer'''
        end
      ) using held;
    exception when object_not_in_prerequisite_state then rejected := true;
    end;
    if not rejected then raise exception 'FAIL 5: a member changed % on a reserved listing', col; end if;
  end loop;
  raise notice 'PASS 5: gallery, fitment, part numbers and the listing''s own content are frozen while reserved';

  -- ==========================================================
  -- N244 6. Going live needs payouts
  -- ==========================================================
  perform pg_temp.as_member(unpaid);
  rejected := false;
  begin
    insert into public.listings(seller_id, title, category, price_cents, status)
    values (unpaid, 'Unpaid live', 'performance', 5000, 'active');
  exception when sqlstate 'LS001' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 6a: an unpaid seller inserted a live listing'; end if;
  -- A draft is fine, and so are its photos; publishing it is not.
  insert into public.listings(id, seller_id, title, category, price_cents, status)
  values (lapsed, unpaid, 'Unpaid draft', 'performance', 5000, 'draft');
  insert into public.listing_images(listing_id, url, position) values (lapsed, unpaid_img || 'one.webp', 0);
  rejected := false;
  begin
    update public.listings set status = 'active' where id = lapsed;
  exception when sqlstate 'LS001' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 6b: an unpaid seller published a draft'; end if;
  -- The sell form's RPC is held to the same rule.
  listing_payload := jsonb_build_object(
    'source_car_id', null, 'title', 'Unpaid via RPC', 'description', null,
    'category', 'performance', 'subcategory', null, 'condition', 'used', 'grade', null,
    'condition_checklist', null, 'price_cents', 5000, 'shipping_cents', 0,
    'shipping_mode', 'flat', 'weight_oz', null, 'length_in', null, 'width_in', null,
    'height_in', null, 'offer_floor_cents', null, 'allows_collection', false,
    'location', null, 'compatibility_notes', null, 'part_number', null, 'status', 'active'
  );
  rejected := false;
  begin
    perform public.save_listing_creation(
      gen_random_uuid(), repeat('a', 64), listing_payload,
      jsonb_build_array(jsonb_build_object('url', unpaid_img || 'rpc.webp', 'alt', null)),
      '[]'::jsonb, '[]'::jsonb, null);
  exception when sqlstate 'LS001' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 6c: save_listing_creation published for an unpaid seller'; end if;
  result := public.save_listing_creation(
    gen_random_uuid(), repeat('b', 64), listing_payload || '{"status":"draft"}'::jsonb,
    jsonb_build_array(jsonb_build_object('url', unpaid_img || 'rpc.webp', 'alt', null)),
    '[]'::jsonb, '[]'::jsonb, null);
  if not (result->>'completed')::boolean then raise exception 'FAIL 6c: an unpaid seller could not save a draft'; end if;
  -- Stub payments: no money loop, no gate (the app's sellerCanPublish).
  perform pg_temp.as_server();
  insert into public.job_config(key, value) values ('payments_mode', 'stub');
  perform pg_temp.as_member(unpaid);
  update public.listings set status = 'active' where id = lapsed;
  set constraints all immediate;
  set constraints all deferred;
  update public.listings set status = 'draft' where id = lapsed;
  perform pg_temp.as_server();
  delete from public.job_config where key = 'payments_mode';
  -- Payouts on: publishing works.
  update public.profiles set payouts_enabled = true where id = unpaid;
  perform pg_temp.as_member(unpaid);
  update public.listings set status = 'active' where id = lapsed;
  set constraints all immediate;
  set constraints all deferred;
  raise notice 'PASS 6: going live needs payouts (insert, publish and the creation RPC); drafts and stub mode are exempt';

  -- ==========================================================
  -- N244 7. Checkout needs a seller who can be paid, at the moment of checkout
  -- ==========================================================
  -- Payouts lapse after the listing went live (account.updated).
  perform pg_temp.as_server();
  update public.profiles set payouts_enabled = false where id = unpaid;
  result := public.purchase_begin(buyer, array[lapsed, live], 'boundary:' || gen_random_uuid(), interval '15 minutes', null, null, null);
  if jsonb_array_length(result->'orders') <> 1
     or (result->'skipped'->0->>'listing_id')::uuid is distinct from lapsed
     or (select status from public.listings where id = lapsed) <> 'active'
     or (select status from public.listings where id = live) <> 'reserved' then
    raise exception 'FAIL 7a: purchase_begin did not skip the unpaid seller''s part: %', result;
  end if;
  -- Any other path that reserves (offer acceptance, a later checkout) is refused.
  rejected := false;
  begin
    update public.listings set status = 'reserved', reserved_until = now() + interval '15 minutes' where id = lapsed;
  exception when sqlstate 'LS001' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 7b: a part of an unpaid seller was reserved'; end if;
  -- Payouts lapse after an offer is accepted (20261107210050): the part is
  -- already reserved, so no new reservation happens, but no new payment
  -- may start. One prepared while payouts were on is the same payment, and
  -- still replays for reconciliation.
  update public.profiles set payouts_enabled = true where id = unpaid;
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
  values (offered, unpaid, 'Accepted offer part', 'performance', 8000, 0, 'active');
  insert into public.offers(listing_id, buyer_id, amount_cents, status)
  values (offered, buyer, 7000, 'open') returning id into offer_id;
  offer_order := public.offer_accept_begin(offer_id, unpaid);
  if offer_order is null or (select status from public.listings where id = offered) <> 'reserved' then
    raise exception 'FAIL 7c: the offer fixture was not accepted';
  end if;
  update public.profiles set payouts_enabled = false where id = unpaid;
  rejected := false;
  begin
    perform public.prepare_payment_request('order:' || offer_order,
      jsonb_build_object('orderIds', jsonb_build_array(offer_order), 'buyerId', buyer, 'totalCents', 7000));
  exception when sqlstate 'LS001' then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 7c: a new payment started for a seller whose payouts lapsed after acceptance'; end if;
  if exists (select 1 from public.payment_requests where operation_key = 'order:' || offer_order) then
    raise exception 'FAIL 7c: the refused payment left a request behind';
  end if;
  -- Prepared while payouts were on, then they lapse: the replay still answers.
  update public.profiles set payouts_enabled = true where id = unpaid;
  prepared := public.prepare_payment_request('order:' || offer_order,
    jsonb_build_object('orderIds', jsonb_build_array(offer_order), 'buyerId', buyer, 'totalCents', 7000));
  update public.profiles set payouts_enabled = false where id = unpaid;
  prepared := public.prepare_payment_request('order:' || offer_order,
    jsonb_build_object('orderIds', jsonb_build_array(offer_order), 'buyerId', buyer, 'totalCents', 7000));
  if prepared->>'correlation_id' is null then
    raise exception 'FAIL 7c: an existing payment request could not be replayed after payouts lapsed';
  end if;
  -- Stub payments reserve as before.
  insert into public.job_config(key, value) values ('payments_mode', 'stub');
  update public.listings set status = 'reserved', reserved_until = now() + interval '15 minutes' where id = lapsed;
  update public.listings set status = 'active', reserved_until = null where id = lapsed;
  delete from public.job_config where key = 'payments_mode';
  raise notice 'PASS 7: checkout skips or refuses a seller whose payouts are off, including after publishing and after an accepted offer';

  -- ==========================================================
  -- N71 8. "Mark sold" is not a sale
  -- ==========================================================
  perform pg_temp.as_member(seller);
  update public.listings set status = 'sold' where id = draft;
  if (select status from public.listings where id = draft) <> 'sold' then
    raise exception 'FAIL 8: the seller could not mark their own part sold';
  end if;
  perform pg_temp.as_server();
  if public.profile_sales_count(seller) <> 0 then
    raise exception 'FAIL 8: a part the seller marked sold counted as a sale';
  end if;
  raise notice 'PASS 8: the sales count counts paid orders, not parts marked sold';

  -- ==========================================================
  -- N26 9. Fraud thresholds stay private; the hold policy is public
  -- ==========================================================
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  rejected := false;
  begin
    perform card_verification_from_cents from public.settlement_settings;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 9: a visitor read settlement_settings'; end if;
  select * into policy from public.settlement_hold_policy();
  if policy.payout_hold_days is null or policy.payout_hold_mode is null then
    raise exception 'FAIL 9: the public hold policy is empty';
  end if;
  perform pg_temp.as_member(buyer);
  rejected := false;
  begin
    perform tracking_required_from_cents from public.settlement_settings;
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'FAIL 9: a member read settlement_settings'; end if;
  perform pg_temp.as_server();
  if exists (
    select 1 from pg_proc p, unnest(p.proargnames) as arg(name)
    where p.oid = 'public.settlement_hold_policy()'::regprocedure and arg.name like '%cents%'
  ) then
    raise exception 'FAIL 9: the public hold policy carries an amount';
  end if;
  raise notice 'PASS 9: thresholds are private, the hold policy is public';

  raise notice 'all listing write boundary checks passed';
end $$;

rollback;
