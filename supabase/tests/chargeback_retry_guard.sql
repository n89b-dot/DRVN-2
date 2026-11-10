-- 20261110170000 (report five #108, OS id N944): Retry a chargeback held for
-- review, done right.
--   E  the event that held it is recorded, and a later event while held
--      replaces it; Retry names that event
--   C  a retried chargeback that settles closes its recovery case by itself
--   T  a chargeback settled before a conflicting event held it can't be
--      retried (a booked loss never becomes a win)
--   N  no recorded event, or no stored payload: refused, saying so
--   A  only a full admin; a dry run changes nothing; a refused retry's
--      journal entry is released while the chargeback is still held
--   P  service role only
-- Every failed check is collected and reported together at the end.
begin;

set constraints all immediate;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  admin_actor uuid := gen_random_uuid();
  sale uuid := gen_random_uuid();
  settled uuid := gen_random_uuid();
  bare uuid := gen_random_uuid();
  case_id uuid;
  r jsonb;
  op jsonb;
  t text;
  msg text;
  fails text[] := '{}';
begin
  insert into public.job_config (key, value) values ('payments_mode', 'stub')
    on conflict (key) do update set value = excluded.value;
  insert into auth.users (id, email, raw_user_meta_data) values
    (seller, 'n944r-seller@drvn.test', '{}'), (buyer, 'n944r-buyer@drvn.test', '{}'), (admin_actor, 'n944r-admin@drvn.test', '{}');
  insert into public.admin_users (user_id, role, note) values (admin_actor, 'admin', 'guard');
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, completed_at) values
    (sale, buyer, seller, 'completed', 5000, 0, 500, 5000, 'USD', now() - interval '3 days'),
    (settled, buyer, seller, 'completed', 4000, 0, 400, 4000, 'USD', now() - interval '3 days'),
    (bare, buyer, seller, 'completed', 3000, 0, 300, 3000, 'USD', now() - interval '3 days');
  -- The payment record is short, so the chargeback doesn't match and is held.
  insert into public.payments (order_id, provider, provider_reference, status, amount_cents, currency)
  values (sale, 'stripe', 'pi_n944r', 'succeeded', 4000, 'USD');
  insert into public.webhook_events (id, type, payload) values
    ('evt_n944r_a', 'charge.dispute.created', '{"id": "evt_n944r_a", "type": "charge.dispute.created"}'),
    ('evt_n944r_b', 'charge.dispute.updated', '{"id": "evt_n944r_b", "type": "charge.dispute.updated"}');

  -- ---------- E ----------
  t := public.apply_stripe_dispute_event('dp_n944r', 'pi_n944r', 5000, 'usd', 'needs_response', false, 'evt_n944r_a', 100, gen_random_uuid());
  if t <> 'recovery_recorded' or (select state from public.stripe_dispute_journal where dispute_id = 'dp_n944r') <> 'recovery' then
    raise exception 'Fixture: the mismatched chargeback was not held (%) (N944)', t;
  end if;
  if (select held_event_id from public.stripe_dispute_journal where dispute_id = 'dp_n944r') is distinct from 'evt_n944r_a'
     or (select held_from_state from public.stripe_dispute_journal where dispute_id = 'dp_n944r') is distinct from 'open' then
    fails := fails || 'FAIL E1: the event that held the chargeback, or the state before, was not recorded (N944)'::text;
  end if;
  t := public.apply_stripe_dispute_event('dp_n944r', 'pi_n944r', 5000, 'usd', 'under_review', false, 'evt_n944r_b', 200, gen_random_uuid());
  if (select held_event_id from public.stripe_dispute_journal where dispute_id = 'dp_n944r') is distinct from 'evt_n944r_b' then
    fails := fails || 'FAIL E2: a later event while held did not become the one to replay (N944)'::text;
  end if;
  t := public.apply_stripe_dispute_event('dp_n944r', 'pi_n944r', 5000, 'usd', 'needs_response', false, 'evt_n944r_a', 100, gen_random_uuid());
  if (select held_event_id from public.stripe_dispute_journal where dispute_id = 'dp_n944r') is distinct from 'evt_n944r_b' then
    fails := fails || 'FAIL E3: an older redelivery replaced the newest held event (N944)'::text;
  end if;

  -- ---------- A ----------
  begin
    perform public.admin_retry_dispute_recovery('dp_n944r', seller, false);
    fails := fails || 'FAIL A1: a member retried a chargeback (N944)'::text;
  exception when others then null;
  end;
  r := public.admin_retry_dispute_recovery('dp_n944r', admin_actor, true);
  if (r->>'reopened')::boolean or r->>'event_id' is distinct from 'evt_n944r_b'
     or (select state from public.stripe_dispute_journal where dispute_id = 'dp_n944r') <> 'recovery'
     or (r->'before'->>'amount_cents')::int <> 5000 then
    fails := fails || format('FAIL A2: the dry run changed the chargeback or misread it (%s) (N944)', r);
  end if;

  -- ---------- C: the record is corrected, Retry, the replay matches, Stripe settles ----------
  select id into case_id from public.payment_recoveries where recovery_key = 'stripe:dispute:dp_n944r';
  update public.payments set amount_cents = 5000 where provider_reference = 'pi_n944r';
  r := public.admin_retry_dispute_recovery('dp_n944r', admin_actor, false);
  if (select state from public.stripe_dispute_journal where dispute_id = 'dp_n944r') <> 'open' then
    fails := fails || 'FAIL C1: Retry did not reopen the chargeback (N944)'::text;
  end if;
  -- The app replays r->>'event_id' through the handler; here, straight in.
  t := public.apply_stripe_dispute_event('dp_n944r', 'pi_n944r', 5000, 'usd', 'under_review', false, 'evt_n944r_b', 200, gen_random_uuid());
  if t <> 'committed' or (select state from public.stripe_dispute_journal where dispute_id = 'dp_n944r') <> 'open' then
    fails := fails || format('FAIL C2: the replayed event did not apply once the record matched (%s) (N944)', t);
  end if;
  t := public.apply_stripe_dispute_event('dp_n944r', 'pi_n944r', 5000, 'usd', 'won', true, 'evt_n944r_c', 300, gen_random_uuid());
  if (select state from public.stripe_dispute_journal where dispute_id = 'dp_n944r') <> 'won'
     or (select status from public.payment_recoveries where id = case_id) <> 'recovered'
     or (select status from public.orders where id = sale) <> 'completed' then
    fails := fails || format('FAIL C3: a retried chargeback that settled left its case open or its order disputed (%s) (N944)', t);
  end if;

  -- ---------- T: a booked loss, then a conflicting win ----------
  insert into public.stripe_dispute_journal (dispute_id, payment_reference, amount_cents, currency, state, last_event_id, last_event_created, order_ids)
  values ('dp_n944r_t', 'pi_n944r_t', 4000, 'usd', 'lost', 'evt_n944r_t1', 100, array[settled]);
  insert into public.webhook_events (id, type, payload) values ('evt_n944r_t2', 'charge.dispute.closed', '{"id": "evt_n944r_t2", "type": "charge.dispute.closed"}');
  t := public.apply_stripe_dispute_event('dp_n944r_t', 'pi_n944r_t', 4000, 'usd', 'won', true, 'evt_n944r_t2', 200, gen_random_uuid());
  if (select held_from_state from public.stripe_dispute_journal where dispute_id = 'dp_n944r_t') is distinct from 'lost' then
    fails := fails || format('FAIL T1: the settled state before the conflicting event was not kept (%s) (N944)', t);
  end if;
  begin
    perform public.admin_retry_dispute_recovery('dp_n944r_t', admin_actor, false);
    fails := fails || 'FAIL T2: a chargeback already lost was retried (N944)'::text;
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like '%already settled as lost%' then fails := fails || format('FAIL T3: the refusal said "%s" (N944)', msg); end if;
  end;
  if (select state from public.stripe_dispute_journal where dispute_id = 'dp_n944r_t') <> 'recovery' then
    fails := fails || 'FAIL T4: a refused retry moved the chargeback (N944)'::text;
  end if;

  -- ---------- N ----------
  insert into public.stripe_dispute_journal (dispute_id, payment_reference, amount_cents, currency, state, last_event_id, last_event_created, order_ids)
  values ('dp_n944r_n', 'pi_n944r_n', 3000, 'usd', 'open', 'evt_n944r_n1', 100, array[bare]);
  perform public.hold_stripe_dispute('dp_n944r_n', 'Held by the old path, with no event');
  begin
    perform public.admin_retry_dispute_recovery('dp_n944r_n', admin_actor, false);
    fails := fails || 'FAIL N1: a hold with no recorded event was retried (N944)'::text;
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like '%No Stripe event is recorded%' then fails := fails || format('FAIL N2: the refusal said "%s" (N944)', msg); end if;
  end;
  update public.stripe_dispute_journal set held_event_id = 'evt_n944r_missing', held_event_created = 150 where dispute_id = 'dp_n944r_n';
  begin
    perform public.admin_retry_dispute_recovery('dp_n944r_n', admin_actor, false);
    fails := fails || 'FAIL N3: a hold whose event isn''t stored was retried (N944)'::text;
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like '%isn''t stored%' then fails := fails || format('FAIL N4: the refusal said "%s" (N944)', msg); end if;
  end;

  -- ---------- A: a refused retry is released while still held ----------
  select id into case_id from public.payment_recoveries where recovery_key = 'stripe:dispute:dp_n944r_n';
  op := public.begin_admin_external_operation(admin_actor, 'recovery.retry_dispute', 'payment', case_id::text, null, 'Guard retry', jsonb_build_object('disputeId', 'dp_n944r_n'));
  r := public.release_refused_dispute_retry(admin_actor, (op->>'operationId')::uuid, 'No Stripe event is recorded');
  if not (r->>'released')::boolean
     or (public.begin_admin_external_operation(admin_actor, 'recovery.retry_dispute', 'payment', case_id::text, null, 'Again', jsonb_build_object('disputeId', 'dp_n944r_n'))->>'reused')::boolean then
    fails := fails || format('FAIL A3: a refused retry left the next one blocked (%s) (N944)', r);
  end if;

  -- ---------- P ----------
  if has_function_privilege('authenticated', 'public.admin_retry_dispute_recovery(text, uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'public.admin_retry_dispute_recovery(text, uuid, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.release_refused_dispute_retry(uuid, uuid, text)', 'execute') then
    fails := fails || 'FAIL P1: a member can reach the chargeback retry (N944)'::text;
  end if;

  if cardinality(fails) > 0 then
    raise exception '%', array_to_string(fails, E'\n');
  end if;
  raise notice 'all chargeback retry checks passed';
end $$;

rollback;
