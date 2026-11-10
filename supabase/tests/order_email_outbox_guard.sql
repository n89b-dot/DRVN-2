-- 20261110140000 (report five #116, OS-W41): order emails through an outbox.
--   Q  an order notice queues one row for its own recipient; a second insert
--      of the same notice changes nothing
--   W  never wider: a notice for A about an order A isn't party to, or with
--      any href but exactly /orders/<uuid>, queues nothing; a notice for A
--      can never queue a row for B
--   S  claims skip a deleted or suspended account, a stale row, a seller with
--      no confirmed address, and anything past 20 an hour to one recipient;
--      a guest buyer is sent their own order's emails
--   D  a deletion request skips that member's pending rows at once
--   C  outcomes are fenced by attempt; no provider skips everything waiting
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
  n uuid;
  r record;
  v_count integer;
  fails text[] := '{}';
begin
  insert into auth.users (id, email, confirmed_at, raw_user_meta_data) values
    (seller, 'n116-seller@drvn.test', now(), '{}'), (buyer, 'n116-buyer@drvn.test', now(), '{}'),
    (stranger, 'n116-stranger@drvn.test', now(), '{}'), (leaver, 'n116-leaver@drvn.test', now(), '{}');
  insert into auth.users (id, email, raw_user_meta_data) values (guest, 'n116-guest@drvn.test', '{"drvn_guest": true}');
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, completed_at) values
    (sale, buyer, seller, 'completed', 5000, 0, 500, 5000, 'USD', now()),
    (guest_sale, guest, seller, 'completed', 5000, 0, 500, 5000, 'USD', now()),
    (leaver_sale, buyer, leaver, 'completed', 5000, 0, 500, 5000, 'USD', now());

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

  -- ---------- C ----------
  update auth.users set confirmed_at = now() where id = seller;
  insert into public.notifications (user_id, kind, section, title, href) values (seller, 'order_delivered', 'marketplace', 'Delivered', '/orders/' || sale) returning id into n;
  select * into r from public.claim_order_emails(50) c where c.recipient_id = seller limit 1;
  if public.complete_order_email(r.id, r.attempt + 1, 'sent') <> 'stale' then
    fails := fails || 'FAIL C1: an outcome for another attempt was recorded (OS-W41)'::text;
  end if;
  if public.complete_order_email(r.id, r.attempt, 'retry', null, 'resend: 503') <> 'pending'
     or (select next_attempt_at from public.order_email_outbox where id = r.id) <= now() then
    fails := fails || 'FAIL C2: a retry was not backed off (OS-W41)'::text;
  end if;
  update public.order_email_outbox set next_attempt_at = now() where id = r.id;
  if public.skip_order_emails_email_off() < 1 or (select skip_reason from public.order_email_outbox where id = r.id) is distinct from 'email_off' then
    fails := fails || 'FAIL C3: with no provider, a waiting email was not skipped (OS-W41)'::text;
  end if;

  -- ---------- P ----------
  if has_table_privilege('authenticated', 'public.order_email_outbox', 'select')
     or has_table_privilege('anon', 'public.order_email_outbox', 'select')
     or has_function_privilege('authenticated', 'public.claim_order_emails(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.complete_order_email(uuid, integer, text, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.raise_payout_setup_reminders()', 'execute') then
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
