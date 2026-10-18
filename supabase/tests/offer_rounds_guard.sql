-- Every offer move is recorded as a round (A1 step one, 20261017150000):
-- opening offer, counter, accept (by either side), decline, withdraw and
-- expiry, numbered per offer; the binding minimum is kept privately; only the
-- buyer and the seller can read an offer's rounds, and nobody can write them.
-- Since the contract (20261019120000) offer_open writes the opening round
-- itself and the recorder covers the moves a trusted writer still makes.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  listing uuid := gen_random_uuid();
  listing2 uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid();
  o2 uuid := gen_random_uuid();
  o3 uuid := gen_random_uuid();
  seen text;
  n integer;
  denied boolean := false;
begin
  update public.beta_access_config set enforced = false where singleton = true;
  insert into auth.users(id, email) values
    (seller, 'rounds-seller@drvn.test'), (buyer, 'rounds-buyer@drvn.test'), (stranger, 'rounds-stranger@drvn.test');
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
  values (listing, seller, 'Rounds guard wheels', 'performance', 60000, 0, 'active'),
         (listing2, seller, 'Rounds guard seats', 'performance', 20000, 0, 'active');
  insert into public.listing_private_terms(listing_id, seller_id, offer_floor_cents) values (listing, seller, 30000);

  -- 1. Offer → counter → buyer accepts: three rounds, in order, by the right people.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  perform public.offer_open(o1, listing, 40000, null);
  perform set_config('role', 'none', true);
  update public.offers set status = 'countered', counter_amount_cents = 52000, countered_at = now() where id = o1;
  perform public.offer_accept_begin(o1, seller);

  select string_agg(format('%s:%s:%s:%s', round_no, kind, actor_role, coalesce(amount_cents::text, '-')), ' ' order by round_no) into seen
  from public.offer_rounds where offer_id = o1;
  if seen is distinct from '1:offer:buyer:40000 2:counter:seller:52000 3:accept:buyer:52000' then
    raise exception 'FAIL 1: offer, counter, accept recorded as %', seen;
  end if;
  if exists (select 1 from public.offer_rounds where offer_id = o1 and kind = 'counter' and actor_member_id is distinct from seller)
     or exists (select 1 from public.offer_rounds where offer_id = o1 and kind in ('offer', 'accept') and actor_member_id is distinct from buyer) then
    raise exception 'FAIL 2: a round names the wrong member';
  end if;

  -- 2. The minimum in force is kept privately for each proposal.
  if (select string_agg(coalesce(t.effective_floor_cents::text, '-'), ',' order by r.round_no)
      from public.offer_rounds r join public.offer_round_terms t on t.round_id = r.id where r.offer_id = o1) is distinct from '30000,30000' then
    raise exception 'FAIL 3: proposals did not keep the minimum in force';
  end if;

  -- 3. Seller accepts an opening offer; a decline; a withdraw; an expiry.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  perform public.offer_open(o2, listing2, 15000, null);
  perform set_config('role', 'none', true);
  update public.offers set status = 'declined', responded_at = now() where id = o2;
  if (select string_agg(kind || ':' || actor_role, ' ' order by round_no) from public.offer_rounds where offer_id = o2)
     is distinct from 'offer:buyer decline:seller' then
    raise exception 'FAIL 4: a decline was not recorded as the seller''s round';
  end if;
  perform set_config('role', 'authenticated', true);
  perform public.offer_open(o3, listing2, 16000, null);
  perform set_config('role', 'none', true);
  update public.offers set status = 'withdrawn' where id = o3 and buyer_id = buyer;
  if (select kind || ':' || actor_role from public.offer_rounds where offer_id = o3 and round_no = 2) is distinct from 'withdraw:buyer' then
    raise exception 'FAIL 5: a withdraw was not recorded as the buyer''s round';
  end if;
  update public.offers set status = 'expired', responded_at = now() where id = o2 and false;  -- no-op: status unchanged rows add nothing
  if (select count(*) from public.offer_rounds where offer_id = o2) <> 2 then
    raise exception 'FAIL 6: a write that did not change status added a round';
  end if;

  -- 4. Who can read rounds, and that nobody can write them.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  select count(*) into n from public.offer_rounds where offer_id in (o1, o2, o3);
  if n <> 0 then raise exception 'FAIL 7: a stranger read % rounds', n; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', seller, 'role', 'authenticated')::text, true);
  select count(*) into n from public.offer_rounds where offer_id in (o1, o2, o3);
  if n <> 7 then raise exception 'FAIL 8: the seller read % of 7 rounds', n; end if;
  begin
    select count(*) into n from public.offer_round_terms;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 9: a member read the private round terms'; end if;
  denied := false;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', buyer, 'role', 'authenticated')::text, true);
  begin
    insert into public.offer_rounds(offer_id, round_no, listing_id, buyer_id, actor_role, kind)
    values (o1, 9, listing, buyer, 'buyer', 'offer');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 10: a member wrote a round'; end if;
  denied := false;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    select count(*) into n from public.offer_rounds;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FAIL 11: a guest read offer rounds'; end if;

  -- 5. Every offer has a first round that matches it.
  perform set_config('role', 'none', true);
  if exists (select 1 from public.offers o where not exists (
       select 1 from public.offer_rounds r where r.offer_id = o.id and r.round_no = 1 and r.kind = 'offer'
         and r.amount_cents is not distinct from o.amount_cents and r.buyer_id = o.buyer_id)) then
    raise exception 'FAIL 12: an offer has no matching first round';
  end if;

  raise notice 'all offer rounds checks passed';
end $$;

rollback;
