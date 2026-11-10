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
-- Work review #147 (N1063):
--   T  first in the file, in a transaction of its own: a notice written with
--      the server key (service_role) queues its email, so the trigger does
--      not run on the writer's permissions; and (T3) a member's own action
--      that raises a notice still works with the trigger on the table
--   H  rows that can never be sent do not hold the queue: one claim passes
--      over them and returns the row behind
--   V  a fault with our own provider account puts the row back uncounted,
--      keeps it 72 hours, not 24, and drops nothing
--   S6, S7 are now a delay: the 21st email in an hour waits, it is not dropped
--   K  the three new kinds queue; F a partial refund raises its notice to both
--      sides with the amount, and a full refund or a lost card dispute does
--      not; M one dispatch reminder per paid order due within a day; X settled
--      rows and reminder ledgers past 90 days are pruned, waiting rows kept
-- Review of #204 (N1063):
--   V5 to V7  one window while a provider fault stands: 30 rows wait, the
--      fault is found on the first, and every one of them is kept 72 hours
--   N  an order whose buyer's account is gone: its seller is still a party
--      and is emailed; a stranger and a missing order are not
--   L  a rate limit is not a strike: the row goes back uncounted, nothing is
--      claimed before the provider's wait, and the queue keeps its order
--   F4 a lost card dispute books the whole remainder: no partial-refund notice
--   M4 a paid order whose seller is gone does not stop the other reminders
--   C4 an email taken as sent on a repeated key keeps a note saying so
-- Every failed check is collected and reported together at the end.
begin;
do $$
declare
  member uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  ord uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, confirmed_at, raw_user_meta_data) values
    (member, 'n1063-key-buyer@drvn.test', now(), '{}'), (other, 'n1063-key-seller@drvn.test', now(), '{}');
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency)
  values (ord, member, other, 'pending', 5000, 0, 500, 5000, 'USD');
  if exists (select 1 from public.notifications where user_id in (member, other)) then
    raise exception 'Fixture: the fixtures already wrote a notification as the owner, so this transaction no longer proves the server key''s write (N1063)';
  end if;
  perform set_config('role', 'service_role', true);
  begin
    insert into public.notifications (user_id, kind, section, title, href) values (member, 'order_paid', 'marketplace', 'Receipt', '/orders/' || ord);
  exception when others then
    perform set_config('role', 'none', true);
    raise exception 'FAIL T1: a notice written with the server key could not be inserted: % (N1063)', sqlerrm;
  end;
  perform set_config('role', 'none', true);
  if (select count(*) from public.order_email_outbox where recipient_id = member and order_id = ord and kind = 'order_paid') <> 1 then
    raise exception 'FAIL T2: a notice written with the server key queued no email (N1063)';
  end if;
end $$;
rollback;

-- T3, in a transaction of its own: a member's own action is the first write
-- to public.notifications. Their follow raises its notice with the outbox
-- trigger on the table, and a notice that is not about an order queues nothing.
begin;
do $$
declare
  follower uuid := gen_random_uuid();
  followed uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, confirmed_at, raw_user_meta_data) values
    (follower, 'n1063-follower@drvn.test', now(), '{}'), (followed, 'n1063-followed@drvn.test', now(), '{}');
  if exists (select 1 from public.notifications where user_id in (follower, followed)) then
    raise exception 'Fixture: the fixtures already wrote a notification as the owner, so this transaction no longer proves a member''s write (N1063)';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', follower, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.follows (follower_id, target_type, target_id) values (follower, 'profile', followed);
  exception when others then
    perform set_config('role', 'none', true);
    raise exception 'FAIL T3: a member''s follow could not raise its notice with the outbox trigger in place: % (N1063)', sqlerrm;
  end;
  perform set_config('role', 'none', true);
  if not exists (select 1 from public.notifications where user_id = followed and kind = 'follow' and actor_id = follower)
     or exists (select 1 from public.order_email_outbox where recipient_id in (follower, followed)) then
    raise exception 'FAIL T3: a member''s follow raised no notice, or queued an order email (N1063)';
  end if;
end $$;
rollback;

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
  h_good uuid;
  v_row uuid;
  o_part uuid := gen_random_uuid();
  o_ship uuid := gen_random_uuid();
  o_later uuid := gen_random_uuid();
  lone uuid := gen_random_uuid();
  o_gone uuid := gen_random_uuid();
  o_orphan uuid := gen_random_uuid();
  o_due uuid := gen_random_uuid();
  o_lost uuid := gen_random_uuid();
  v_is_buyer boolean;
  v_ids uuid[];
  v_first uuid;
  v_oldest uuid;
  v_later uuid;
  v_other uuid;
  fails text[] := '{}';
begin
  insert into auth.users (id, email, confirmed_at, raw_user_meta_data) values
    (seller, 'n116-seller@drvn.test', now(), '{}'), (buyer, 'n116-buyer@drvn.test', now(), '{}'),
    (stranger, 'n116-stranger@drvn.test', now(), '{}'), (leaver, 'n116-leaver@drvn.test', now(), '{}'),
    (holder, 'n116-holder@drvn.test', now(), '{}'), (lone, 'n116-lone@drvn.test', now(), '{}');
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
  if not exists (select 1 from public.order_email_outbox where notification_id = n and status = 'pending' and skip_reason is null
                    and attempts = 0 and next_attempt_at between now() + interval '29 minutes' and now() + interval '31 minutes') then
    fails := fails || 'FAIL S6: the 21st email in an hour to one recipient was dropped or sent, not made to wait (N1063)'::text;
  end if;

  -- Rows being sent count towards the cap too.
  update public.order_email_outbox set sent_at = now() - interval '2 hours' where recipient_id = buyer and status = 'sent';
  for v_count in 1..20 loop
    insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, status, lease_expires_at, attempts)
    values (gen_random_uuid(), buyer, sale, 'order_shipped', 'sending', now() + interval '5 minutes', 1);
  end loop;
  insert into public.notifications (user_id, kind, section, title, href) values (buyer, 'order_delivered', 'marketplace', 'Delivered', '/orders/' || sale) returning id into n;
  perform public.claim_order_emails(50);
  if not exists (select 1 from public.order_email_outbox where notification_id = n and status = 'pending' and next_attempt_at > now() + interval '29 minutes') then
    fails := fails || 'FAIL S7: emails being sent did not count towards the hourly cap (OS-W41)'::text;
  end if;
  -- Clear what S6 and S7 left waiting, so the checks below start from an empty queue.
  update public.order_email_outbox set status = 'sent', sent_at = now() - interval '2 hours' where recipient_id = buyer and status = 'pending';
  update public.order_email_outbox set status = 'sent', sent_at = now() - interval '2 hours', lease_expires_at = null where recipient_id = buyer and status = 'sending';


  -- ---------- H: rows that can never be sent do not hold the queue ----------
  update public.order_email_outbox set status = 'sent', sent_at = now() - interval '3 hours' where status in ('pending', 'sending');
  for v_count in 1..3 loop
    insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, created_at, next_attempt_at)
    values (gen_random_uuid(), buyer, sale, 'order_shipped', now() - interval '30 hours', now() - interval '30 hours');
  end loop;
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, next_attempt_at)
  values (gen_random_uuid(), buyer, sale, 'order_delivered', now() - interval '1 minute') returning id into h_good;
  select count(*), max(c.id::text)::uuid, bool_and(c.buyer) into v_count, v_row, v_is_buyer from public.claim_order_emails(1) c;
  if v_count <> 1 or v_row is distinct from h_good then
    fails := fails || format('FAIL H1: three rows that could never be sent held the queue: one claim returned %s row(s) (N1063)', v_count);
  end if;
  if v_is_buyer is distinct from true then
    fails := fails || format('FAIL H3: the claim did not say a buyer''s own row is the buyer''s (buyer = %s) (N1063)', v_is_buyer);
  end if;
  if (select count(*) from public.order_email_outbox where recipient_id = buyer and skip_reason = 'stale' and created_at < now() - interval '29 hours') <> 3 then
    fails := fails || 'FAIL H2: the rows passed over were not marked skipped as stale (N1063)'::text;
  end if;

  -- ---------- V: our own provider account at fault ----------
  v_text := public.complete_order_email(h_good, 1, 'provider', null, 'resend: 401 missing_api_key');
  if v_text <> 'held' or not exists (select 1 from public.order_email_outbox where id = h_good and status = 'pending' and attempts = 0
       and provider_held_at is not null and last_error = 'resend: 401 missing_api_key' and lease_id is null
       and next_attempt_at between now() + interval '9 minutes' and now() + interval '11 minutes') then
    fails := fails || format('FAIL V1: a provider fault did not put the row back uncounted (%s) (N1063)', v_text);
  end if;
  -- Held rows outlast the ordinary 24 hours, and not 72.
  update public.order_email_outbox set created_at = now() - interval '30 hours', next_attempt_at = now() - interval '1 minute' where id = h_good;
  if (select count(*) from public.claim_order_emails(1)) <> 1 then
    fails := fails || 'FAIL V2: a row held for a provider fault was dropped as stale after a day (N1063)'::text;
  end if;
  perform public.complete_order_email(h_good, 1, 'provider', null, 'resend: 401 missing_api_key');
  update public.order_email_outbox set created_at = now() - interval '73 hours', next_attempt_at = now() - interval '1 minute' where id = h_good;
  perform public.claim_order_emails(1);
  if (select skip_reason from public.order_email_outbox where id = h_good) is distinct from 'stale' then
    fails := fails || 'FAIL V3: a held row was still being kept after 72 hours (N1063)'::text;
  end if;
  -- Five ordinary retries still end in failed: only a provider fault is uncounted.
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, status, attempts, lease_expires_at)
  values (gen_random_uuid(), buyer, sale, 'order_delivered', 'sending', 5, now() + interval '5 minutes') returning id into v_row;
  if public.complete_order_email(v_row, 5, 'retry', null, 'resend: 503') <> 'failed' then
    fails := fails || 'FAIL V4: a fifth failed attempt did not end the row as failed (N1063)'::text;
  end if;

  -- ---------- V5 to V7: one window while a provider fault stands (review of #204) ----------
  update public.order_email_outbox set status = 'sent', sent_at = now() - interval '3 hours', lease_id = null, lease_expires_at = null where status in ('pending', 'sending');
  for v_count in 1..30 loop
    insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, created_at, next_attempt_at)
    values (gen_random_uuid(), buyer, sale, 'order_shipped', now() - make_interval(mins => 31 - v_count), now() - make_interval(mins => 31 - v_count));
  end loop;
  select array_agg(q.id) into v_ids from public.order_email_outbox q where q.status = 'pending';
  select c.id, c.attempt into v_row, v_count from public.claim_order_emails(1) c;
  perform public.complete_order_email(v_row, v_count, 'provider', null, 'resend: 403');
  if cardinality(v_ids) <> 30
     or (select count(*) from public.order_email_outbox where id = any(v_ids) and status = 'pending' and provider_held_at is not null) <> 30 then
    fails := fails || format('FAIL V5: a provider fault found on the first of 30 waiting rows marked %s of them as held (N1063)',
      (select count(*) from public.order_email_outbox where id = any(v_ids) and provider_held_at is not null));
  end if;
  -- 25 hours on, the fault still standing: none has gone stale.
  update public.order_email_outbox set created_at = now() - interval '25 hours', next_attempt_at = now() - interval '1 minute' where id = any(v_ids);
  perform public.claim_order_emails(50);
  if exists (select 1 from public.order_email_outbox where id = any(v_ids) and skip_reason = 'stale') then
    fails := fails || format('FAIL V6: %s of 30 rows waiting behind a provider fault went stale after 25 hours, never having been tried (N1063)',
      (select count(*) from public.order_email_outbox where id = any(v_ids) and skip_reason = 'stale'));
  end if;
  -- 73 hours on: all of them are.
  update public.order_email_outbox
     set status = 'pending', skip_reason = null, lease_id = null, lease_expires_at = null,
         created_at = now() - interval '73 hours', next_attempt_at = now() - interval '1 minute'
   where id = any(v_ids);
  perform public.claim_order_emails(50);
  if (select count(*) from public.order_email_outbox where id = any(v_ids) and skip_reason = 'stale') <> 30 then
    fails := fails || format('FAIL V7: after 73 hours only %s of 30 held rows were given up as stale (N1063)',
      (select count(*) from public.order_email_outbox where id = any(v_ids) and skip_reason = 'stale'));
  end if;

  -- ---------- N: an order whose buyer's account is gone (review of #204) ----------
  update public.order_email_outbox set status = 'sent', sent_at = now() - interval '3 hours', lease_id = null, lease_expires_at = null where status in ('pending', 'sending');
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, completed_at)
  values (o_gone, null, lone, 'completed', 5000, 0, 500, 5000, 'USD', now());
  insert into public.notifications (user_id, kind, section, title, href) values (lone, 'dispute_resolved', 'marketplace', 'Dispute resolved', '/orders/' || o_gone);
  if (select count(*) from public.order_email_outbox where order_id = o_gone and recipient_id = lone and status = 'pending') <> 1 then
    fails := fails || 'FAIL N1: a notice to the seller of an order whose buyer is gone queued no email (N1063)'::text;
  end if;
  select count(*), max(c.id::text)::uuid, bool_or(c.buyer) into v_count, v_row, v_is_buyer from public.claim_order_emails(5) c;
  if v_count <> 1 or exists (select 1 from public.order_email_outbox where order_id = o_gone and status = 'skipped') then
    fails := fails || format('FAIL N2: the seller of an order whose buyer is gone was not emailed: %s claimed, skipped as %s (N1063)', v_count,
      (select string_agg(skip_reason, ', ') from public.order_email_outbox where order_id = o_gone and status = 'skipped'));
  elsif v_is_buyer is distinct from false then
    fails := fails || format('FAIL N2b: the claim said the seller''s row is the buyer''s (buyer = %s) (N1063)', v_is_buyer);
  end if;
  -- Someone who is not on the order, and an order that is not there, are still not parties.
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind) values (gen_random_uuid(), stranger, o_gone, 'dispute_resolved') returning id into v_other;
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind) values (gen_random_uuid(), lone, gen_random_uuid(), 'dispute_resolved') returning id into v_later;
  perform public.claim_order_emails(5);
  if (select count(*) from public.order_email_outbox where id in (v_other, v_later) and skip_reason = 'not_a_party') <> 2 then
    fails := fails || 'FAIL N3: a stranger to the order, or a row for an order that does not exist, was not passed over (N1063)'::text;
  end if;

  -- ---------- L: a rate limit is not a strike (review of #204) ----------
  -- v_row is the seller's row from N, being sent on its first attempt. Two more wait behind it, and one is set for later.
  if v_row is null then
    insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, status, attempts, lease_expires_at)
    values (gen_random_uuid(), lone, o_gone, 'dispute_resolved', 'sending', 1, now() + interval '5 minutes') returning id into v_row;
  end if;
  -- Their ids are chosen so that the oldest row is neither the lowest nor the highest: an order by id, either way, would not find it.
  insert into public.order_email_outbox (id, notification_id, recipient_id, order_id, kind, created_at, next_attempt_at) values
    ('00000000-0000-4000-8000-00000000a204', gen_random_uuid(), lone, o_gone, 'admin_action', now() - interval '2 minutes', now() - interval '1 minute'),
    ('ffffffff-ffff-4fff-bfff-ffffffffa204', gen_random_uuid(), lone, o_gone, 'admin_action', now() - interval '1 minute', now() - interval '45 seconds');
  v_first := '00000000-0000-4000-8000-00000000a204';
  insert into public.order_email_outbox (id, notification_id, recipient_id, order_id, kind, created_at, next_attempt_at)
  values ('80000000-0000-4000-8000-00000000a204', gen_random_uuid(), lone, o_gone, 'admin_action', now() - interval '3 minutes', now() - interval '30 seconds') returning id into v_oldest;
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, next_attempt_at)
  values (gen_random_uuid(), lone, o_gone, 'admin_action', now() + interval '2 hours') returning id into v_later;
  v_text := public.complete_order_email(v_row, 1, 'rate_limited', null, 'resend: 429 rate_limit_exceeded', null, 7);
  if v_text is distinct from 'limited' or not exists (select 1 from public.order_email_outbox where id = v_row and status = 'pending' and attempts = 0
       and lease_id is null and last_error = 'resend: 429 rate_limit_exceeded' and next_attempt_at = now() + interval '7 seconds') then
    fails := fails || format('FAIL L1: a rate-limited send was not put back uncounted for the provider''s wait (%s) (N1063)', v_text);
  end if;
  if exists (select 1 from public.order_email_outbox where status = 'pending' and next_attempt_at < now() + interval '7 seconds')
     or (select count(*) from public.claim_order_emails(5)) <> 0 then
    fails := fails || 'FAIL L2: a waiting row could be claimed before the provider''s wait was over (N1063)'::text;
  end if;
  if (select next_attempt_at from public.order_email_outbox where id = v_later) is distinct from now() + interval '2 hours' then
    fails := fails || 'FAIL L3: a row set for later was pulled forward by a rate limit (N1063)'::text;
  end if;
  -- The wait over, the queue is taken in the order it was written, though every row now carries the same time.
  update public.order_email_outbox set next_attempt_at = now() - interval '1 second' where id in (v_row, v_first, v_oldest, 'ffffffff-ffff-4fff-bfff-ffffffffa204');
  if (select c.id from public.claim_order_emails(1) c) is distinct from v_oldest then
    fails := fails || 'FAIL L4: after a rate limit the queue was not taken oldest first (N1063)'::text;
  end if;
  -- A fifth attempt that is rate-limited is not the end of the row; with no wait named it waits a minute; an absurd wait is an hour.
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, status, attempts, lease_expires_at)
  values (gen_random_uuid(), lone, o_gone, 'admin_action', 'sending', 5, now() + interval '5 minutes') returning id into v_other;
  v_text := public.complete_order_email(v_other, 5, 'rate_limited', null, 'resend: 429');
  if v_text is distinct from 'limited' or not exists (select 1 from public.order_email_outbox where id = v_other and status = 'pending' and attempts = 4
       and next_attempt_at = now() + interval '60 seconds') then
    fails := fails || format('FAIL L5: a rate limit on a fifth attempt ended the row, or did not wait a minute (%s, %s) (N1063)', v_text,
      (select status || ' after ' || attempts from public.order_email_outbox where id = v_other));
  end if;
  update public.order_email_outbox set status = 'sending', attempts = 1, lease_expires_at = now() + interval '5 minutes' where id = v_other;
  perform public.complete_order_email(v_other, 1, 'rate_limited', null, null, null, 999999);
  if (select next_attempt_at from public.order_email_outbox where id = v_other) is distinct from now() + interval '1 hour' then
    fails := fails || 'FAIL L6: a rate limit''s wait was not held to an hour (N1063)'::text;
  end if;
  update public.order_email_outbox set status = 'sent', sent_at = now() - interval '3 hours', lease_id = null, lease_expires_at = null where status in ('pending', 'sending');

  -- ---------- K: the new kinds queue ----------
  insert into public.notifications (user_id, kind, section, title, href) values
    (buyer, 'order_cancelled', 'marketplace', 'Order cancelled', '/orders/' || sale),
    (seller, 'dispatch_reminder', 'marketplace', 'An order is due to be dispatched', '/orders/' || sale);
  if (select count(*) from public.order_email_outbox where order_id = sale and kind in ('order_cancelled', 'dispatch_reminder') and status = 'pending') <> 2 then
    fails := fails || 'FAIL K1: a cancelled-order notice or a dispatch reminder queued no email (N1063)'::text;
  end if;

  -- ---------- F: a partial refund raises its own notice ----------
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency) values
    (o_part, buyer, holder, 'paid', 5000, 0, 500, 5000, 'USD');
  update public.orders set refunded_cents = 1550 where id = o_part;
  if (select count(*) from public.notifications where kind = 'order_partially_refunded' and href = '/orders/' || o_part and body like '15.50 USD %') <> 2
     or not exists (select 1 from public.notifications where kind = 'order_partially_refunded' and user_id = buyer and href = '/orders/' || o_part and title = 'Part of your order was refunded')
     or (select count(*) from public.order_email_outbox where order_id = o_part and kind = 'order_partially_refunded') <> 2 then
    fails := fails || format('FAIL F1: a partial refund did not tell both sides, with the amount: %s (N1063)',
      (select string_agg(title || ' / ' || coalesce(body, ''), ' | ') from public.notifications where href = '/orders/' || o_part));
  end if;
  -- A second part: its own amount, not the running total.
  update public.orders set refunded_cents = 2000 where id = o_part;
  if (select count(*) from public.notifications where kind = 'order_partially_refunded' and href = '/orders/' || o_part and body like '4.50 USD %') <> 2 then
    fails := fails || 'FAIL F2: a second partial refund did not give its own amount (N1063)'::text;
  end if;
  -- The rest, making it a full refund, and a card dispute the bank decided: neither is a partial refund from DRVN.
  update public.orders set refunded_cents = 5000, status = 'refunded' where id = o_part;
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency) values
    (o_later, buyer, holder, 'paid', 5000, 0, 500, 5000, 'USD');
  update public.orders set refunded_cents = 2500, cancel_reason = 'Card dispute lost (dp_n1063)' where id = o_later;
  if (select count(*) from public.notifications where kind = 'order_partially_refunded' and href = '/orders/' || o_part) <> 4
     or exists (select 1 from public.notifications where kind = 'order_partially_refunded' and href = '/orders/' || o_later) then
    fails := fails || 'FAIL F3: a full refund or a lost card dispute was announced as a partial refund (N1063)'::text;
  end if;
  -- What a lost card dispute books in production: the whole remainder, the order refunded, with the bank's reason.
  -- An earlier part-refund from DRVN on the same order was announced (two notices); the bank's decision adds none.
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency) values
    (o_lost, buyer, holder, 'paid', 5000, 0, 500, 5000, 'USD');
  update public.orders set refunded_cents = 1000 where id = o_lost;
  update public.orders set refunded_cents = 5000, status = 'refunded', cancel_reason = 'Card dispute lost (dp_n1063b)' where id = o_lost;
  if (select count(*) from public.notifications where kind = 'order_partially_refunded' and href = '/orders/' || o_lost) <> 2 then
    fails := fails || format('FAIL F4: a lost card dispute that booked the whole remainder left %s partial-refund notices, not the 2 from the earlier part-refund (N1063)',
      (select count(*) from public.notifications where kind = 'order_partially_refunded' and href = '/orders/' || o_lost));
  end if;

  -- ---------- M: one dispatch reminder per paid order due within a day ----------
  delete from public.notifications where kind = 'dispatch_reminder';
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency) values
    (o_ship, buyer, holder, 'paid', 5000, 0, 500, 5000, 'USD');
  -- dispatch_by is frozen at purchase (freeze_order_deadlines), so the fixture sets it with triggers off.
  perform set_config('session_replication_role', 'replica', true);
  update public.orders set dispatch_by = now() + interval '12 hours', shipped_at = null where id = o_ship;
  update public.orders set dispatch_by = now() + interval '3 days', shipped_at = null, cancel_reason = null, refunded_cents = 0 where id = o_later;
  perform set_config('session_replication_role', 'origin', true);
  v_count := public.raise_dispatch_reminders();
  if (select count(*) from public.notifications where kind = 'dispatch_reminder' and user_id = holder and href = '/orders/' || o_ship) <> 1
     or exists (select 1 from public.notifications where kind = 'dispatch_reminder' and href = '/orders/' || o_later)
     or (select count(*) from public.order_email_outbox where order_id = o_ship and kind = 'dispatch_reminder' and recipient_id = holder) <> 1 then
    fails := fails || format('FAIL M1: the dispatch reminder did not go once, to the seller of the order due within a day (%s raised) (N1063)', v_count);
  end if;
  if public.raise_dispatch_reminders() <> 0 or (select count(*) from public.notifications where kind = 'dispatch_reminder' and href = '/orders/' || o_ship) <> 1 then
    fails := fails || 'FAIL M2: a second run reminded the same order again (N1063)'::text;
  end if;
  perform set_config('session_replication_role', 'replica', true);
  update public.orders set dispatch_by = now() + interval '6 hours', shipped_at = now() where id = o_later;
  perform set_config('session_replication_role', 'origin', true);
  if public.raise_dispatch_reminders() <> 0 then
    fails := fails || 'FAIL M3: an order already dispatched was reminded (N1063)'::text;
  end if;
  -- A paid order whose seller's account is gone has nobody to remind, and must not stop the reminder behind it.
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency) values
    (o_orphan, buyer, null, 'paid', 5000, 0, 500, 5000, 'USD'),
    (o_due, buyer, lone, 'paid', 5000, 0, 500, 5000, 'USD');
  perform set_config('session_replication_role', 'replica', true);
  update public.orders set dispatch_by = now() + interval '6 hours', shipped_at = null where id = o_orphan;
  update public.orders set dispatch_by = now() + interval '7 hours', shipped_at = null where id = o_due;
  perform set_config('session_replication_role', 'origin', true);
  begin
    v_count := public.raise_dispatch_reminders();
    if v_count <> 1
       or not exists (select 1 from public.notifications where kind = 'dispatch_reminder' and user_id = lone and href = '/orders/' || o_due)
       or exists (select 1 from public.dispatch_reminders where order_id = o_orphan) then
      fails := fails || format('FAIL M4: with a sellerless order due first, %s reminder(s) were raised, not the one behind it (N1063)', v_count);
    end if;
  exception when others then
    get stacked diagnostics v_text = message_text;
    fails := fails || format('FAIL M4b: an order whose seller is gone stopped every dispatch reminder (%s) (N1063)', v_text);
  end;

  -- ---------- X: pruning ----------
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, status, sent_at, updated_at) values
    (gen_random_uuid(), buyer, sale, 'order_shipped', 'sent', now() - interval '91 days', now() - interval '91 days'),
    (gen_random_uuid(), buyer, sale, 'order_shipped', 'failed', null, now() - interval '91 days'),
    (gen_random_uuid(), buyer, sale, 'order_shipped', 'sent', now() - interval '89 days', now() - interval '89 days');
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, status, updated_at, created_at)
  values (gen_random_uuid(), buyer, sale, 'order_shipped', 'pending', now() - interval '91 days', now() - interval '91 days') returning id into v_row;
  update public.dispatch_reminders set created_at = now() - interval '91 days' where order_id = o_ship;
  perform private.prune_cron_history();
  if exists (select 1 from public.order_email_outbox where status in ('sent', 'skipped', 'failed') and updated_at < now() - interval '90 days')
     or not exists (select 1 from public.order_email_outbox where status = 'sent' and updated_at < now() - interval '88 days')
     or not exists (select 1 from public.order_email_outbox where id = v_row)
     or exists (select 1 from public.dispatch_reminders where order_id = o_ship) then
    fails := fails || 'FAIL X1: settled rows past 90 days were kept, or a newer or a waiting row was removed (N1063)'::text;
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
  -- An email taken as sent because the provider refused its key as already used keeps a note saying so; an ordinary one keeps none.
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, status, attempts, lease_expires_at, last_error)
  values (gen_random_uuid(), lone, o_gone, 'admin_action', 'sending', 2, now() + interval '5 minutes', 'resend: 503') returning id into v_row;
  v_text := public.complete_order_email(v_row, 2, 'sent', null, 'resend: taken as sent, the key was already used');
  if v_text is distinct from 'sent' or (select last_error from public.order_email_outbox where id = v_row) is distinct from 'resend: taken as sent, the key was already used' then
    fails := fails || 'FAIL C4: an email taken as sent on a repeated key kept no note of it (N1063)'::text;
  end if;
  insert into public.order_email_outbox (notification_id, recipient_id, order_id, kind, status, attempts, lease_expires_at, last_error)
  values (gen_random_uuid(), lone, o_gone, 'admin_action', 'sending', 2, now() + interval '5 minutes', 'resend: 503') returning id into v_row;
  perform public.complete_order_email(v_row, 2, 'sent', 're_guard');
  if (select last_error from public.order_email_outbox where id = v_row) is not null then
    fails := fails || 'FAIL C5: an email the provider accepted kept an old error (N1063)'::text;
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
     or has_function_privilege('authenticated', 'public.complete_order_email(uuid, integer, text, text, text, text, integer)', 'execute')
     or to_regprocedure('public.complete_order_email(uuid, integer, text, text, text, text)') is not null
     or has_function_privilege('authenticated', 'public.raise_payout_setup_reminders()', 'execute')
     or has_function_privilege('authenticated', 'public.raise_dispatch_reminders()', 'execute')
     or has_table_privilege('authenticated', 'public.dispatch_reminders', 'select')
     or has_table_privilege('authenticated', 'public.payout_setup_reminders', 'select') then
    fails := fails || 'FAIL P1: a member can reach the order email outbox (OS-W41)'::text;
  end if;
  if not exists (select 1 from private.scheduled_job_inventory() where job = 'drvn-transfer-worker' and 'orderEmails' = any(families)) then
    fails := fails || 'FAIL P2: the money pass is not inventoried with orderEmails (OS-W41)'::text;
  end if;

  if cardinality(fails) > 0 then
    raise exception 'The order email outbox (N1063, OS-W41): %', E'\n' || array_to_string(fails, E'\n');
  end if;
  raise notice 'all order email outbox checks passed';
end $$;

rollback;
