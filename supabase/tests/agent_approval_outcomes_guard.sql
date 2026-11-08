-- N128 (20261107210500): an approval is recorded as accepted only when the
-- offer move reports an accept. Each answer has its own outcome, on the
-- approval, in the owner's 'approval' event and in what the RPC returns:
--   1. accepted: the seller's accept made the sale (status 'approved').
--   2. expired: the offer's turn had run out. The expiry is recorded, nothing
--      is sold, and the approval says 'expired', never 'approved'.
--   3. refused: the part was gone, so the accept failed (OF007). The move is
--      rolled back, the approval says 'refused', the task waits again.
--   4. noop: the buyer withdrew before the owner answered. The approval stays
--      'superseded' and nothing is written.
--   5. dismissed: unchanged.
--   6. Repeats replay the stored outcome and write nothing.
--   7. 'Approvals answered' counts the expired and refused answers.
-- N677: this guard flaked on main ("FAIL 8: a refused accept was recorded as
-- refused /"). The cause was not ordering: agent_redact_event scrubbed card-
-- like digit runs out of every event, and about 0.3% of random UUIDs carry
-- one, so the owner's 'approval' event sometimes stored a mangled
-- approval_id and pg_temp.answers() found nothing. 20261108130500 (#158)
-- stopped redaction scanning UUIDs. FAIL 0 now proves that on thousands of
-- random ids before any case runs, FAIL 7 asserts the answer was not a
-- replay, and FAIL 7b names a mangled id directly, so a regression fails
-- every run, where it happens, with a message that says why.
-- Transactional; disposable local database only.
begin;

create function pg_temp.act(p_member uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true), set_config('request.jwt.claims', jsonb_build_object('sub', p_member, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.worker() returns void language sql as $$
  select set_config('role', 'agent_worker', true), set_config('request.jwt.claims', '', true);
$$;

create function pg_temp.reset() returns void language sql as $$
  select set_config('role', 'none', true), set_config('request.jwt.claims', '', true);
$$;

-- The seller's agent on p_part asks its owner to accept the buyer's opening offer.
create function pg_temp.ask(p_seller uuid, p_buyer uuid, p_part uuid, p_offer uuid) returns uuid language plpgsql as $$
declare
  j record;
  v uuid;
begin
  perform pg_temp.act(p_seller);
  perform public.agent_mandate_set('seller', p_part, 60000, null, null, null, 'balanced', null, true);
  perform pg_temp.act(p_buyer);
  perform public.offer_open(p_offer, p_part, 70000, null);
  perform pg_temp.worker();
  select c.job_id, c.lease_id into j from public.agent_claim_jobs(10, 60) c where c.offer_id = p_offer limit 1;
  if j.job_id is null then raise exception 'SETUP: no seller turn was queued for %', p_offer; end if;
  v := public.agent_request_approval(j.job_id, j.lease_id, p_offer, 1, 'Worth taking');
  perform pg_temp.reset();
  return v;
end $$;

-- The owner's own answers recorded for an approval.
create function pg_temp.answers(p_approval uuid) returns text language sql as $$
  select coalesce(string_agg(e.result->>'outcome', ',' order by e.created_at, e.id), '')
  from public.agent_events e
  where e.kind = 'approval' and e.initiated_by = 'owner' and e.result->>'approval_id' = p_approval::text;
$$;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  pa uuid := gen_random_uuid();
  pb uuid := gen_random_uuid();
  pc uuid := gen_random_uuid();
  pd uuid := gen_random_uuid();
  pe uuid := gen_random_uuid();
  oa uuid := gen_random_uuid();
  ob uuid := gen_random_uuid();
  oc uuid := gen_random_uuid();
  od uuid := gen_random_uuid();
  oe uuid := gen_random_uuid();
  aa uuid;
  ab uuid;
  ac uuid;
  ad uuid;
  ae uuid;
  r jsonb;
  bad text;
  m record;
  expected numeric;
begin
  -- 0. Redaction never changes an id (N677). Before 20261108130500 about 15
  -- of these 5,000 would have been mangled, and the fixed one always was.
  select string_agg(u, ', ') into bad
  from (select g::text as u from (select gen_random_uuid() as g from generate_series(1, 5000)) x
        -- and one the old rule always mangled, so the check never rests on chance alone
        union all select '70e95888-a964-4164-9858-10b5e67f70ec') ids
  where public.agent_redact_cards(u) is distinct from u
     or public.agent_redact_cards('{"approval_id": "' || u || '"}') is distinct from '{"approval_id": "' || u || '"}';
  if bad is not null then
    raise exception 'FAIL 0: card redaction changed random ids, so an approval event can lose its approval_id (N677): %', left(bad, 400);
  end if;

  update public.agent_controls set cleared_at = now() where scope = 'all' and cleared_at is null;
  update public.agent_beta_steps set open = true where step in ('seller', 'buyer');
  insert into auth.users(id, email) values (seller, 'outcome-guard-seller@drvn.test'), (buyer, 'outcome-guard-buyer@drvn.test');
  insert into public.listings(id, seller_id, title, category, price_cents, shipping_cents, status)
  values (pa, seller, 'Outcome guard turbo', 'performance', 100000, 0, 'active'),
         (pb, seller, 'Outcome guard wheels', 'performance', 100000, 0, 'active'),
         (pc, seller, 'Outcome guard seats', 'performance', 100000, 0, 'active'),
         (pd, seller, 'Outcome guard exhaust', 'performance', 100000, 0, 'active'),
         (pe, seller, 'Outcome guard intake', 'performance', 100000, 0, 'active');

  aa := pg_temp.ask(seller, buyer, pa, oa);
  ab := pg_temp.ask(seller, buyer, pb, ob);
  ac := pg_temp.ask(seller, buyer, pc, oc);
  ad := pg_temp.ask(seller, buyer, pd, od);
  ae := pg_temp.ask(seller, buyer, pe, oe);
  if (select count(*) from public.agent_approvals where id in (aa, ab, ac, ad, ae) and status = 'pending') <> 5 then
    raise exception 'SETUP: the five approvals are not pending';
  end if;

  -- 1. Accepted: the sale is made and recorded as accepted.
  perform pg_temp.act(seller);
  r := public.agent_approval_decide(aa, 'accept');
  perform pg_temp.reset();
  if r->>'outcome' <> 'accepted' or r->>'status' <> 'approved' or (r->>'replayed')::boolean or r->>'order_id' is null then
    raise exception 'FAIL 1: an accept that went through did not report accepted (%)', r;
  end if;
  if (select status from public.offers where id = oa) <> 'accepted'
     or (select status from public.agent_approvals where id = aa) <> 'approved'
     or pg_temp.answers(aa) <> 'accepted' then
    raise exception 'FAIL 2: an accept that went through was not recorded as accepted (%)', pg_temp.answers(aa);
  end if;

  -- 2. Expired: the turn ran out before the owner answered.
  update public.offers set expires_at = now() - interval '1 minute' where id = ob;
  perform pg_temp.act(seller);
  r := public.agent_approval_decide(ab, 'accept');
  perform pg_temp.reset();
  if r->>'outcome' <> 'expired' or r->>'status' <> 'expired' or r->>'order_id' is not null then
    raise exception 'FAIL 3: accepting an expired offer did not report expired (%)', r;
  end if;
  if (select status from public.agent_approvals where id = ab) <> 'expired' then
    raise exception 'FAIL 4: accepting an expired offer was recorded as % (N128)', (select status from public.agent_approvals where id = ab);
  end if;
  if pg_temp.answers(ab) <> 'expired' then
    raise exception 'FAIL 5: the owner''s answer on an expired offer was logged as % (N128)', pg_temp.answers(ab);
  end if;
  if (select status from public.offers where id = ob) <> 'expired'
     or exists (select 1 from public.orders where origin_offer_id = ob)
     or exists (select 1 from public.offer_rounds where offer_id = ob and kind = 'accept')
     or not exists (select 1 from public.offer_rounds where offer_id = ob and kind = 'expire') then
    raise exception 'FAIL 6: an expired offer was sold, or its expiry was not recorded';
  end if;

  -- 3. Refused: the part went before the owner answered (OF007).
  update public.listings set status = 'sold', sold_at = now() where id = pc;
  perform pg_temp.act(seller);
  r := public.agent_approval_decide(ac, 'accept');
  perform pg_temp.reset();
  if r->>'outcome' <> 'refused' or r->>'status' <> 'refused' or r->>'order_id' is not null
     or (r->>'replayed')::boolean is distinct from false then
    raise exception 'FAIL 7: an accept the offer refused did not report a fresh refusal (N677) (%)', r;
  end if;
  if pg_temp.answers(ac) = '' and exists (
       select 1 from public.agent_events e join public.agent_approvals a on a.task_id = e.task_id
       where a.id = ac and e.kind = 'approval' and e.initiated_by = 'owner') then
    raise exception 'FAIL 7b: the owner''s answer was logged but its approval_id was changed to % (N677)',
      (select string_agg(e.result->>'approval_id', ', ') from public.agent_events e join public.agent_approvals a on a.task_id = e.task_id
       where a.id = ac and e.kind = 'approval' and e.initiated_by = 'owner');
  end if;
  if (select status from public.agent_approvals where id = ac) <> 'refused' or pg_temp.answers(ac) <> 'refused' then
    raise exception 'FAIL 8: a refused accept was recorded as % / %', (select status from public.agent_approvals where id = ac), pg_temp.answers(ac);
  end if;
  if (select status || ':' || round_count from public.offers where id = oc) <> 'open:1'
     or exists (select 1 from public.orders where origin_offer_id = oc)
     or exists (select 1 from public.offer_rounds where offer_id = oc and round_no > 1) then
    raise exception 'FAIL 9: a refused accept changed the offer';
  end if;
  if (select t.status from public.agent_tasks t join public.agent_approvals a on a.task_id = t.id where a.id = ac) <> 'waiting_for_event' then
    raise exception 'FAIL 10: the task did not go back to waiting after a refused accept';
  end if;

  -- 4. No-op: the buyer withdrew first, so the card had lapsed.
  perform pg_temp.act(buyer);
  r := public.offer_move(od, 'withdraw', null, 'outcome-guard-withdraw', 1);
  perform pg_temp.reset();
  if (select status from public.agent_approvals where id = ad) <> 'superseded' then
    raise exception 'SETUP: the withdrawal did not supersede the approval';
  end if;
  perform pg_temp.act(seller);
  r := public.agent_approval_decide(ad, 'accept');
  perform pg_temp.reset();
  if r->>'outcome' <> 'noop' or r->>'status' <> 'superseded' or not (r->>'replayed')::boolean then
    raise exception 'FAIL 11: accepting a lapsed approval did not report a no-op (%)', r;
  end if;
  if (select status from public.agent_approvals where id = ad) <> 'superseded' or pg_temp.answers(ad) <> ''
     or (select status from public.offers where id = od) <> 'withdrawn' then
    raise exception 'FAIL 12: a no-op answer wrote something (%)', pg_temp.answers(ad);
  end if;

  -- 5. Dismissed.
  perform pg_temp.act(seller);
  r := public.agent_approval_decide(ae, 'dismiss');
  perform pg_temp.reset();
  if r->>'outcome' <> 'dismissed' or r->>'status' <> 'dismissed'
     or (select status from public.agent_approvals where id = ae) <> 'dismissed' or pg_temp.answers(ae) <> 'dismissed'
     or (select status from public.offers where id = oe) <> 'open' then
    raise exception 'FAIL 13: a dismissal was not recorded as dismissed (%)', r;
  end if;

  -- 6. Repeats replay the stored outcome and write nothing.
  perform pg_temp.act(seller);
  if public.agent_approval_decide(aa, 'accept')->>'outcome' <> 'accepted'
     or public.agent_approval_decide(ab, 'accept')->>'outcome' <> 'expired'
     or public.agent_approval_decide(ac, 'accept')->>'outcome' <> 'refused'
     or public.agent_approval_decide(ae, 'accept')->>'outcome' <> 'dismissed'
     or not (public.agent_approval_decide(ab, 'accept')->>'replayed')::boolean then
    raise exception 'FAIL 14: a repeated answer did not replay its outcome';
  end if;
  perform pg_temp.reset();
  if pg_temp.answers(aa) <> 'accepted' or pg_temp.answers(ab) <> 'expired' or pg_temp.answers(ac) <> 'refused'
     or (select status from public.agent_approvals where id = ab) <> 'expired' then
    raise exception 'FAIL 15: a repeated answer wrote again';
  end if;

  -- 7. The owner answered the expired and refused cards: they count as answered.
  perform public.agent_compute_metrics((now() at time zone 'utc')::date);
  select value, sample into m from public.agent_metrics_daily
  where day = (now() at time zone 'utc')::date and scope = 'seller' and measure = 'approvals_answered';
  select avg(case when a.status in ('approved', 'dismissed', 'expired', 'refused') then 1 else 0 end) into expected
  from public.agent_approvals a join public.agent_tasks t on t.id = a.task_id
  where t.scope = 'seller' and a.created_at >= (now() at time zone 'utc')::date::timestamp at time zone 'utc'
    and a.created_at < ((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc';
  if m.sample is null or m.sample < 5 or m.value is distinct from round(expected, 4)
     or (m.sample = 5 and m.value <> 0.8) then
    raise exception 'FAIL 16: approvals answered is % of % (expected %)', m.value, m.sample, round(expected, 4);
  end if;

  raise notice 'all agent approval outcome checks passed';
end $$;

rollback;
