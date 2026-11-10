-- 20261111090000 (report five #116, OS-W41): order emails through an outbox.
--   Q  an order notice queues one row for its own recipient; a second insert
--      of the same notice changes nothing
--   W  never wider: a notice for A about an order A isn't party to, or with
--      any href but exactly /orders/<uuid>, queues nothing; a notice for A
--      can never queue a row for B
--   S  claims skip a deleted or suspended account, a stale row, a seller with
--      no confirmed address, and anything past 20 an hour to one recipient;
--      a guest buyer is sent their own order's emails
--   D  a deletion request skips that member's pending rows at once; one held
--      for money owed doesn't, and a withdrawn one leaves nothing skipped
--      from then on
--   C  outcomes are fenced by attempt; no provider skips everything waiting
--   R  payout-setup reminders: one a day per seller on days 3, 7 and 12,
--      covering every unpaid sale; none on day 2, after set-up or after a
--      refund; a second run the same day raises nothing
--   P  members and visitors can't read the outbox or call its functions
-- Every failed check is collected and reported together at the end.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  guest uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  leaver uuid := gen_random_uuid();
  sale uuid := gen_random_uuid();
  guest_sale uuid := gen_random_uuid();
  leaver_sale uuid := gen_random_uuid();
  holder uuid := gen_random_uuid();
  holder_sale uuid := gen_random_uuid();
  s_two uuid := gen_random_uuid();
  s_many uuid := gen_random_uuid();
  s_set uuid := gen_random_uuid();
  s_refund uuid := gen_random_uuid();
  s_last uuid := gen_random_uuid();
  o_two uuid := gen_random_uuid();
  o_three uuid := gen_random_uuid();
  o_seven uuid := gen_random_uuid();
  o_set uuid := gen_random_uuid();
  o_refund uuid := gen_random_uuid();
  o_last uuid := gen_random_uuid();
  n uuid;
  r record;
  v_count integer;
  v_text text;
  fails text[] := '{}';
begin
  insert into auth.users (id, email, confirmed_at, raw_user_meta_data) values
    (seller, 'n116-seller@drvn.test', now(), '{}'), (buyer, 'n116-buyer@drvn.test', now(), '{}'),
    (stranger, 'n116-stranger@drvn.test', now(), '{}'), (leaver, 'n116-leaver@drvn.test', now(), '{}'),
    (holder, 'n116-holder@drvn.test', now(), '{}');
  insert into auth.users (id, email, raw_user_meta_data) values (guest, 'n116-guest@drvn.test', '{"drvn_guest": true}');
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, completed_at) values
    (sale, buyer, seller, 'completed', 5000, 0, 500, 5000, 'USD', now()),
    (guest_sale, guest, seller, 'completed', 5000, 0, 500, 5000, 'USD', now()),
    (leaver_sale, buyer, leaver, 'completed', 5000, 0, 500, 5000, 'USD', now()),
    (holder_sale, buyer, holder, 'completed', 5000, 0, 500, 5000, 'USD', now());

  -- ---------- Q ----------
  insert into public.notifications (user_id, kind, section, title, href) values (seller, 'order_sold', 'marketplace', 'Sold', '/orders/' || sale)
    returning id into n;
  if (select count(*) from public.order_email_outbox where notification_id = n and recipient_id = seller and order_id = sale and kind = 'order_sold' and status = 'pending') <> 1 then
    fails := fails || 'FAIL Q1: an order notice did not queue exactly one email for its recipient (OS-W41)'::text;
  end if;
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind) values (n, seller, sale, 'order_sold') on conflict (notification_id) do nothing;
  if (select count(*) from public.order_email_outbox where notification_id = n) <> 1 then
    fails := fails || 'FAIL Q2: one notice made two outbox rows (OS-W41)'::text;
  end if;
  insert into public.notifications (user_id, kind, section, title, href) values (buyer, 'follow', 'engagement', 'Follow', '/orders/' || sale);
  if exists (select 1 from public.order_email_outbox where recipient_id = buyer and kind = 'follow') then
    fails := fails || 'FAIL Q3: a non-order notice queued an email (OS-W41)'::text;
  end if;

  -- ---------- W ----------
  insert into public.notifications (user_id, kind, section, title, href) values
    (stranger, 'order_paid', 'marketplace', 'x', '/orders/' || sale),
    (buyer, 'order_paid', 'marketplace', 'x', '/orders/' || sale || '?x=1'),
    (buyer, 'order_paid', 'marketplace', 'x', '/orders/' || sale || '#y'),
    (buyer, 'order_paid', 'marketplace', 'x', '/orders/not-a-uuid'),
    (buyer, 'order_paid', 'marketplace', 'x', '/listings/' || sale),
    (buyer, 'order_paid', 'marketplace', 'x', null);
  if exists (select 1 from public.order_email_outbox where recipient_id = stranger)
     or (select count(*) from public.order_email_outbox where recipient_id = buyer) <> 0 then
    fails := fails || 'FAIL W1: a notice for someone not on the order, or with a malformed href, queued an email (OS-W41)'::text;
  end if;
  insert into public.notifications (user_id, kind, section, title, href) values (buyer, 'order_paid', 'marketplace', 'Receipt', '/orders/' || sale);
  if exists (select 1 from public.order_email_outbox o join public.notifications x on x.id = o.notification_id where o.recipient_id <> x.user_id) then
    fails := fails || 'FAIL W2: an outbox row is addressed to someone other than its notice''s recipient (OS-W41)'::text;
  end if;

  -- ---------- S ----------
  insert into public.notifications (user_id, kind, section, title, href) values (guest, 'order_paid', 'marketplace', 'Receipt', '/orders/' || guest_sale);
  -- A seller row on the guest's order, for an address-less seller: made unconfirmed below.
  update public.order_email_outbox set created_at = now() - interval '25 hours' where recipient_id = seller and kind = 'order_sold';
  v_count := 0;
  for r in select * from public.claim_order_emails(50) loop
    v_count := v_count + 1;
    if r.recipient_id = buyer and (r.email <> 'n116-buyer@drvn.test' or r.guest) then fails := fails || 'FAIL S1: a member''s address was not read at claim (OS-W41)'::text; end if;
    if r.recipient_id = guest and (not r.guest or r.email <> 'n116-guest@drvn.test') then fails := fails || 'FAIL S2: a guest buyer''s receipt was not sent to their own order''s address (OS-W41)'::text; end if;
  end loop;
  if v_count <> 2 then fails := fails || format('FAIL S3: expected the buyer''s and the guest''s receipts, claimed %s (OS-W41)', v_count); end if;
  if (select skip_reason from public.order_email_outbox where recipient_id = seller and kind = 'order_sold') is distinct from 'stale' then
    fails := fails || 'FAIL S4: a row older than 24 hours was not skipped as stale (OS-W41)'::text;
  end if;
  -- A seller with no confirmed address (as a guest would be) is never sent seller emails.
  update auth.users set confirmed_at = null where id = seller;
  insert into public.notifications (user_id, kind, section, title, href) values (seller, 'order_sold', 'marketplace', 'Sold', '/orders/' || guest_sale);
  perform public.claim_order_emails(50);
  if (select skip_reason from public.order_email_outbox where recipient_id = seller and order_id = guest_sale) is distinct from 'no_address' then
    fails := fails || 'FAIL S5: an unconfirmed address got a seller''s email (OS-W41)'::text;
  end if;
  -- More than 20 an hour to one recipient: the rest are skipped.
  update public.order_email_outbox set status = 'sent', sent_at = now() where recipient_id = buyer;
  for v_count in 1..20 loop
    insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, status, sent_at) values (gen_random_uuid(), buyer, sale, 'order_shipped', 'sent', now());
  end loop;
  insert into public.notifications (user_id, kind, section, title, href) values (buyer, 'order_shipped', 'marketplace', 'Shipped', '/orders/' || sale) returning id into n;
  perform public.claim_order_emails(50);
  if (select skip_reason from public.order_email_outbox where notification_id = n) is distinct from 'rate_capped' then
    fails := fails || 'FAIL S6: the 21st email in an hour to one recipient was not skipped (OS-W41)'::text;
  end if;

  -- Rows being sent count towards the cap too.
  update public.order_email_outbox set sent_at = now() - interval '2 hours' where recipient_id = buyer and status = 'sent';
  for v_count in 1..20 loop
    insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, status, lease_expires_at, attempts)
    values (gen_random_uuid(), buyer, sale, 'order_shipped', 'sending', now() + interval '5 minutes', 1);
  end loop;
  insert into public.notifications (user_id, kind, section, title, href) values (buyer, 'order_delivered', 'marketplace', 'Delivered', '/orders/' || sale) returning id into n;
  perform public.claim_order_emails(50);
  if (select skip_reason from public.order_email_outbox where notification_id = n) is distinct from 'rate_capped' then
    fails := fails || 'FAIL S7: emails being sent did not count towards the hourly cap (OS-W41)'::text;
  end if;
  update public.order_email_outbox set status = 'sent', sent_at = now() - interval '2 hours', lease_expires_at = null where recipient_id = buyer and status = 'sending';

  -- ---------- D ----------
  insert into public.notifications (user_id, kind, section, title, href) values (leaver, 'order_sold', 'marketplace', 'Sold', '/orders/' || leaver_sale) returning id into n;
  insert into public.account_deletion_requests (user_id, outcome, next_action, responsible_owner) values (leaver, 'cleanup_pending', 'Automated cleanup is in progress.', 'privacy worker');
  if (select skip_reason from public.order_email_outbox where notification_id = n) is distinct from 'account_closed' then
    fails := fails || 'FAIL D1: a deletion request left the member''s pending emails sendable (OS-W41)'::text;
  end if;
  insert into public.notifications (user_id, kind, section, title, href) values (leaver, 'order_delivered', 'marketplace', 'Delivered', '/orders/' || leaver_sale) returning id into n;
  perform public.claim_order_emails(50);
  if (select skip_reason from public.order_email_outbox where notification_id = n) is distinct from 'account_closed' then
    fails := fails || 'FAIL D2: a deleted account''s email was claimed instead of skipped (OS-W41)'::text;
  end if;

  -- A deletion held for money owed: the member still settles the order, so
  -- the emails still go.
  insert into public.account_deletion_requests (user_id, outcome, next_action, responsible_owner)
  values (holder, 'temporary_financial_hold', 'Settle the open order.', 'privacy worker');
  insert into public.notifications (user_id, kind, section, title, href) values (holder, 'order_sold', 'marketplace', 'Sold', '/orders/' || holder_sale) returning id into n;
  select * into r from public.claim_order_emails(50) c where c.recipient_id = holder limit 1;
  if r.id is null or (select status from public.order_email_outbox where notification_id = n) <> 'sending' then
    fails := fails || 'FAIL D3: a deletion held for money owed stopped the member''s order emails (OS-W41)'::text;
  end if;
  -- Withdrawn (the request row is gone): nothing from then on is skipped.
  delete from public.account_deletion_requests where user_id = leaver;
  insert into public.notifications (user_id, kind, section, title, href) values (leaver, 'order_shipped', 'marketplace', 'Shipped', '/orders/' || leaver_sale) returning id into n;
  perform public.claim_order_emails(50);
  if (select status from public.order_email_outbox where notification_id = n) <> 'sending' then
    fails := fails || 'FAIL D4: a withdrawn deletion request left the member skipped (OS-W41)'::text;
  end if;

  -- ---------- C ----------
  update auth.users set confirmed_at = now() where id = seller;
  insert into public.notifications (user_id, kind, section, title, href) values (seller, 'order_delivered', 'marketplace', 'Delivered', '/orders/' || sale) returning id into n;
  select * into r from public.claim_order_emails(50) c where c.recipient_id = seller limit 1;
  if public.complete_order_email(r.id, r.attempt + 1, 'sent') <> 'stale' then
    fails := fails || 'FAIL C1: an outcome for another attempt was recorded (OS-W41)'::text;
  end if;
  -- Call, then read the row in a separate statement: a volatile call and a
  -- read of its effect in one expression need not see each other.
  v_text := public.complete_order_email(r.id, r.attempt, 'retry', null, 'resend: 503');
  if v_text is distinct from 'pending'
     or (select next_attempt_at from public.order_email_outbox where id = r.id) <= now() then
    fails := fails || 'FAIL C2: a retry was not backed off (OS-W41)'::text;
  end if;
  update public.order_email_outbox set next_attempt_at = now() where id = r.id;
  v_count := public.skip_order_emails_email_off();
  if v_count < 1 or (select skip_reason from public.order_email_outbox where id = r.id) is distinct from 'email_off' then
    fails := fails || 'FAIL C3: with no provider, a waiting email was not skipped (OS-W41)'::text;
  end if;

  -- ---------- R ----------
  insert into auth.users (id, email, confirmed_at, raw_user_meta_data) values
    (s_two, 'n116-r2@drvn.test', now(), '{}'), (s_many, 'n116-rmany@drvn.test', now(), '{}'), (s_set, 'n116-rset@drvn.test', now(), '{}'),
    (s_refund, 'n116-rrefund@drvn.test', now(), '{}'), (s_last, 'n116-rlast@drvn.test', now(), '{}');
  update public.profiles set payouts_enabled = false where id in (s_two, s_many, s_refund, s_last);
  update public.profiles set payouts_enabled = true where id = s_set;
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, completed_at) values
    (o_two, buyer, s_two, 'completed', 5000, 0, 500, 5000, 'USD', now()),
    (o_three, buyer, s_many, 'completed', 5000, 0, 500, 5000, 'USD', now()),
    (o_seven, buyer, s_many, 'completed', 5000, 0, 500, 5000, 'USD', now()),
    (o_set, buyer, s_set, 'completed', 5000, 0, 500, 5000, 'USD', now()),
    (o_refund, buyer, s_refund, 'refunded', 5000, 0, 500, 5000, 'USD', now()),
    (o_last, buyer, s_last, 'completed', 5000, 0, 500, 5000, 'USD', now());
  insert into public.transfer_intents (order_id, seller_id, amount_cents, currency, status, created_at) values
    (o_two, s_two, 4500, 'USD', 'holding', now() - interval '2 days'),
    (o_three, s_many, 4500, 'USD', 'holding', now() - interval '3 days'),
    (o_seven, s_many, 4500, 'USD', 'holding', now() - interval '7 days'),
    (o_set, s_set, 4500, 'USD', 'holding', now() - interval '3 days'),
    (o_refund, s_refund, 4500, 'USD', 'holding', now() - interval '7 days'),
    (o_last, s_last, 4500, 'USD', 'holding', now() - interval '12 days');
  v_count := public.raise_payout_setup_reminders();
  if exists (select 1 from public.notifications where kind = 'payout_setup_reminder' and user_id in (s_two, s_set, s_refund)) then
    fails := fails || 'FAIL R1: a reminder went on day 2, after payouts were set up, or after a refund (OS-W41)'::text;
  end if;
  if (select count(*) from public.notifications where kind = 'payout_setup_reminder' and user_id = s_many) <> 1
     or (select href from public.notifications where kind = 'payout_setup_reminder' and user_id = s_many) <> '/orders/' || o_seven
     or (select sale_count from public.payout_setup_reminders where seller_id = s_many and reminded_on = current_date) is distinct from 2 then
    fails := fails || 'FAIL R2: a seller with sales on days 3 and 7 did not get one reminder covering both, linked to the oldest (OS-W41)'::text;
  end if;
  if (select count(*) from public.notifications where kind = 'payout_setup_reminder' and user_id = s_last and body like '2 days left%') <> 1
     or not exists (select 1 from public.order_email_outbox where recipient_id = s_last and kind = 'payout_setup_reminder' and order_id = o_last) then
    fails := fails || 'FAIL R3: a day-12 sale did not get its two-days-left reminder and email (OS-W41)'::text;
  end if;
  if v_count <> 2 then
    fails := fails || format('FAIL R4: expected two reminders, raised %s (OS-W41)', v_count);
  end if;
  v_count := public.raise_payout_setup_reminders();
  if v_count <> 0 or (select count(*) from public.notifications where kind = 'payout_setup_reminder' and user_id in (s_many, s_last)) <> 2 then
    fails := fails || 'FAIL R5: a second run the same day raised another reminder (OS-W41)'::text;
  end if;
  -- The dedupe is its own row: deleting the in-app notice doesn't re-send.
  delete from public.notifications where kind = 'payout_setup_reminder' and user_id = s_many;
  v_count := public.raise_payout_setup_reminders();
  if v_count <> 0 then
    fails := fails || 'FAIL R6: a deleted notice let the same day''s reminder go again (OS-W41)'::text;
  end if;

  -- ---------- P ----------
  if has_table_privilege('authenticated', 'public.order_email_outbox', 'select')
     or has_table_privilege('anon', 'public.order_email_outbox', 'select')
     or has_function_privilege('authenticated', 'public.claim_order_emails(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.complete_order_email(uuid, integer, text, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.raise_payout_setup_reminders()', 'execute')
     or has_table_privilege('authenticated', 'public.payout_setup_reminders', 'select') then
    fails := fails || 'FAIL P1: a member can reach the order email outbox (OS-W41)'::text;
  end if;
  if not exists (select 1 from private.scheduled_job_inventory() where job = 'drvn-transfer-worker' and 'orderEmails' = any(families)) then
    fails := fails || 'FAIL P2: the money pass is not inventoried with orderEmails (OS-W41)'::text;
  end if;

  if cardinality(fails) > 0 then
    raise exception '%', array_to_string(fails, E'\n');
  end if;
  raise notice 'all order email outbox checks passed';
end $$;

rollback;
