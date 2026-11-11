-- 20261111150000 (Codex's final review, P1 on 20261111090000): a row held for
-- a provider fault stays retryable for 72 hours, but the email provider keeps
-- an idempotency key for 24. An attempt the provider may have accepted (a
-- lost lease, or a retry after the send was made) and a resume more than a
-- day later sent the email twice.
--   W1  a row whose lease ran out more than 20 hours ago is not sent again:
--       it fails, and an order_email_failed alert is queued
--   W2  a row retried after a send, then held past 20 hours, is not sent again
--   W3  a row the provider refused outright (our account at fault) was never
--       handed over: held past 20 hours it is still sent, as before
--   W4  a row retried before any send (p_reason 'not_sent') is still sent
--   W5  a lost lease inside the window is claimed again, as before (the
--       provider's key keeps it from going out twice)
-- Times are relative to now(); nothing waits.
begin;

do $$
declare
  seller uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  sale uuid := gen_random_uuid();
  w1 uuid; w2 uuid; w3 uuid; w4 uuid; w5 uuid;
  got uuid[];
  tracked boolean;
  fails text[] := '{}';
begin
  insert into auth.users (id, email, confirmed_at, raw_user_meta_data) values
    (seller, 'resend-window-seller@drvn.test', now(), '{}'), (buyer, 'resend-window-buyer@drvn.test', now(), '{}');
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, completed_at) values
    (sale, buyer, seller, 'completed', 5000, 0, 500, 5000, 'USD', now());
  -- Start from an empty queue.
  update public.order_email_outbox set status = 'skipped', skip_reason = 'email_off' where status in ('pending', 'sending');
  tracked := exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'order_email_outbox' and column_name = 'handed_to_provider_at');

  -- ---------- W1, W5: lost leases ----------
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, status, attempts, lease_expires_at, created_at, provider_held_at, next_attempt_at)
    values (gen_random_uuid(), buyer, sale, 'order_shipped', 'sending', 1, now() - interval '30 hours' + interval '5 minutes',
            now() - interval '30 hours', now() - interval '29 hours', now() - interval '30 hours')
    returning id into w1;
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, status, attempts, lease_expires_at, created_at, provider_held_at, next_attempt_at)
    values (gen_random_uuid(), buyer, sale, 'order_delivered', 'sending', 1, now() - interval '2 hours' + interval '5 minutes',
            now() - interval '2 hours', now() - interval '1 hour', now() - interval '2 hours')
    returning id into w5;
  select array_agg(c.id) into got from public.claim_order_emails(50) c;
  if w1 = any(coalesce(got, '{}')) then
    fails := fails || 'FAIL W1: a row whose lease ran out 30 hours ago, past the provider''s 24-hour key, was claimed to be sent again (Codex final review)'::text;
  elsif (select status from public.order_email_outbox where id = w1) <> 'failed'
     or not exists (select 1 from public.admin_alert_outbox where dedup_key = 'order-email-failed:' || w1 and kind = 'order_email_failed' and order_id = sale) then
    fails := fails || 'FAIL W1: a row that may have been sent and is past the window did not fail with an alert (Codex final review)'::text;
  end if;
  if not (w5 = any(coalesce(got, '{}'))) then
    fails := fails || 'FAIL W5: a lost lease inside the window was not claimed again (Codex final review)'::text;
  end if;
  perform public.complete_order_email(w5, 2, 'sent', 're_w5');

  -- ---------- W2: retried after a send ----------
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind) values (gen_random_uuid(), buyer, sale, 'order_paid') returning id into w2;
  perform public.claim_order_emails(1);
  perform public.complete_order_email(w2, 1, 'retry', null, 'send timed out or threw');
  -- ---------- W4: retried before any send ----------
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind) values (gen_random_uuid(), buyer, sale, 'order_refunded') returning id into w4;
  perform public.claim_order_emails(1);
  perform public.complete_order_email(w4, 1, 'retry', null, 'order unreadable', 'not_sent');
  -- ---------- W3: refused outright ----------
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind) values (gen_random_uuid(), buyer, sale, 'order_cancelled') returning id into w3;
  perform public.claim_order_emails(1);
  perform public.complete_order_email(w3, 1, 'provider', null, 'resend: 401 missing_api_key');
  -- (Read by name only once the column exists, so the guard runs, and fails, on the database before the fix.)
  if tracked then
    execute 'select array_agg(id) from public.order_email_outbox where id = any($1) and handed_to_provider_at is not null'
      into got using array[w2, w3, w4];
    if not (w2 = any(coalesce(got, '{}'))) then
      fails := fails || 'FAIL W2: a retry after a send did not record that the provider may have it (Codex final review)'::text;
    end if;
    if w3 = any(coalesce(got, '{}')) or w4 = any(coalesce(got, '{}')) then
      fails := fails || 'FAIL W3: a row never handed to the provider was recorded as handed over (Codex final review)'::text;
    end if;
  end if;

  -- 30 hours on: all three held for the provider fault, all due.
  update public.order_email_outbox
     set created_at = created_at - interval '30 hours', provider_held_at = now() - interval '29 hours',
         next_attempt_at = now() - interval '1 minute', status = 'pending'
   where id in (w2, w3, w4);
  if tracked then
    execute 'update public.order_email_outbox set handed_to_provider_at = handed_to_provider_at - interval ''30 hours'' where id = any($1)' using array[w2, w3, w4];
  end if;
  select array_agg(c.id) into got from public.claim_order_emails(50) c;
  if w2 = any(coalesce(got, '{}')) then
    fails := fails || 'FAIL W2: a row retried after a send 30 hours ago was claimed to be sent again (Codex final review)'::text;
  elsif (select status from public.order_email_outbox where id = w2) <> 'failed'
     or not exists (select 1 from public.admin_alert_outbox where dedup_key = 'order-email-failed:' || w2) then
    fails := fails || 'FAIL W2: a row retried after a send and past the window did not fail with an alert (Codex final review)'::text;
  end if;
  if not (w3 = any(coalesce(got, '{}'))) then
    fails := fails || 'FAIL W3: a held row the provider refused outright was not sent (Codex final review)'::text;
  end if;
  if not (w4 = any(coalesce(got, '{}'))) then
    fails := fails || 'FAIL W4: a held row retried before any send was not sent (Codex final review)'::text;
  end if;

  if cardinality(fails) > 0 then
    raise exception 'An order email could go out twice past the provider''s idempotency window: %', E'\n' || array_to_string(fails, E'\n');
  end if;
  raise notice 'all order email resend window checks passed';
end $$;

rollback;
