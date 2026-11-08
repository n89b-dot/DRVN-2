-- OS-W33 N77 (20261107220700): a listing with offers is withdrawn, never
-- deleted; live offers end with a reason, buyers are told, history stays.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer_a uuid := gen_random_uuid();
  buyer_b uuid := gen_random_uuid();
  part uuid := gen_random_uuid();
  bare uuid := gen_random_uuid();
  held uuid := gen_random_uuid();
  open_offer uuid := gen_random_uuid();
  countered_offer uuid := gen_random_uuid();
  declined_offer uuid := gen_random_uuid();
  result jsonb;
  refused text;
  src text;
begin
  insert into auth.users(id, email, raw_user_meta_data) values
    (seller, 'w33-seller@drvn.test', '{}'), (buyer_a, 'w33-a@drvn.test', '{}'), (buyer_b, 'w33-b@drvn.test', '{}');
  insert into public.listings(id, seller_id, title, category, price_cents, status) values
    (part, seller, 'W33 part', 'performance', 10000, 'active'),
    (bare, seller, 'W33 no offers', 'performance', 10000, 'active'),
    (held, seller, 'W33 reserved', 'performance', 10000, 'active');
  insert into public.offers(id, listing_id, buyer_id, amount_cents, status) values
    (open_offer, part, buyer_a, 8000, 'open'),
    (countered_offer, part, buyer_b, 7000, 'open'),
    (declined_offer, held, buyer_a, 5000, 'open');
  update public.offers set status = 'countered', counter_amount_cents = 9000 where id = countered_offer;
  update public.offers set status = 'declined' where id = declined_offer;
  update public.listings set status = 'reserved' where id = held;

  -- The listing row is locked before any offer row: the order offer moves
  -- and checkout use, so the two can't deadlock.
  select prosrc into src from pg_proc where oid = 'public.withdraw_listing(uuid)'::regprocedure;
  if position('from public.listings where id = p_listing for update' in src) = 0
     or position('from public.listings where id = p_listing for update' in src) > position('from public.offers o' in src) then
    raise exception 'FAIL 1: withdraw_listing does not lock the listing before its offers';
  end if;
  if has_function_privilege('anon', 'public.withdraw_listing(uuid)', 'execute') then
    raise exception 'FAIL 2: visitors can withdraw listings';
  end if;

  -- A buyer can't withdraw someone else's listing.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', buyer_a, 'role', 'authenticated')::text, true);
  refused := null;
  begin perform public.withdraw_listing(part); exception when sqlstate 'P0002' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 3: a non-seller withdrew a listing'; end if;

  -- The seller can't delete it outright while it has offers.
  perform set_config('request.jwt.claims', json_build_object('sub', seller, 'role', 'authenticated')::text, true);
  refused := null;
  begin delete from public.listings where id = part; exception when sqlstate 'LW409' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 4: a listing with offers was deleted, taking the buyers'' offers'; end if;
  -- …nor withdraw one an order holds.
  refused := null;
  begin perform public.withdraw_listing(held); exception when sqlstate 'LW423' then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 5: a reserved listing was withdrawn under its order'; end if;

  result := public.withdraw_listing(part);
  if (result->>'offers_ended')::int <> 2 then raise exception 'FAIL 6: % live offers ended, not 2', result->>'offers_ended'; end if;
  if (public.withdraw_listing(part))->>'replayed' <> 'true' then raise exception 'FAIL 7: withdrawing twice was not a replay'; end if;

  -- A listing nobody offered on can still be deleted.
  delete from public.listings where id = bare;
  perform set_config('role', 'none', true);
  if exists (select 1 from public.listings where id = bare) then raise exception 'FAIL 8: a listing without offers could not be deleted'; end if;

  if (select status from public.listings where id = part) <> 'archived' then raise exception 'FAIL 9: the withdrawn listing is not archived'; end if;
  if (select count(*) from public.offers where listing_id = part and status = 'withdrawn' and ended_reason = 'listing_withdrawn') <> 2 then
    raise exception 'FAIL 10: live offers did not end with the listing-withdrawal reason';
  end if;
  if (select status from public.offers where id = declined_offer) <> 'declined' then raise exception 'FAIL 11: a settled offer was changed'; end if;
  if (select count(*) from public.offer_rounds where listing_id = part and kind = 'withdraw' and actor_role = 'system') <> 2
     or exists (select 1 from public.offers o where o.listing_id = part and o.last_round_id is distinct from
                (select r.id from public.offer_rounds r where r.offer_id = o.id order by r.round_no desc limit 1)) then
    raise exception 'FAIL 12: the history does not record who ended the offers';
  end if;
  if (select count(*) from public.notifications where kind = 'offer_listing_withdrawn' and user_id in (buyer_a, buyer_b)) <> 2 then
    raise exception 'FAIL 13: the buyers were not told';
  end if;
  -- An offer row can't claim the reason without having ended.
  refused := null;
  begin update public.offers set ended_reason = 'listing_withdrawn' where id = declined_offer;
  exception when check_violation then refused := 'yes'; end;
  if refused is null then raise exception 'FAIL 14: an offer carries a withdrawal reason it did not end with'; end if;

  -- Trusted server paths (account deletion) still remove listings outright.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  delete from public.listings where id = part;

  raise notice 'all withdraw listing checks passed';
end $$;

rollback;
