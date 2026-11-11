-- N418: account deletion keeps personal data (Codex post-merge review of
-- #149; 20261108180000_deletion_late_holds_and_previews.sql).
--   P  other members' notifications lose the deleted member's words: a
--      comment holding a phone number, a question, a legacy message
--      notification and a follow; order notifications keep DRVN's own text
--   K  the per-handle lock: the scrub takes it before the tombstone, and a
--      claim takes it before reading tombstones (the two-session race is in
--      username_tombstone_race_guard.sql)
--   L  a hold after the scrub: a finished case is marked for an operator,
--      never requeued to give sign-in back; a case still in the queue is
--      paused for the operator, not the member; the gate and finalise say
--      it is scrubbed; once the hold settles the case cleans up again; an
--      unscrubbed case still pauses for the member as before
--   R  cases retained before the scrub existed are requeued once through
--      the normal path, and the hold gate still comes first
-- Every failed check is collected and reported together at the end, so one
-- run shows each defect. Calls to helpers this migration adds go through
-- pg_temp wrappers that answer null when the helper is missing.
begin;

-- The hold watch is deferred to commit; this guard rolls back, so it fires
-- at the end of each statement instead.
set constraints all immediate;

create function pg_temp.lock_key(p_handle text) returns bigint language plpgsql as $$
declare
  v bigint;
begin
  execute 'select private.username_lock_key($1)' into v using p_handle;
  return v;
exception when undefined_function then
  return null;
end $$;

-- Whether this backend holds the transaction advisory lock for p_key.
create function pg_temp.holds_advisory(p_key bigint) returns boolean language sql as $$
  select p_key is not null and exists (
    select 1 from pg_locks
     where locktype = 'advisory' and pid = pg_backend_pid() and granted and objsubid = 1
       and classid::bigint = ((p_key >> 32) & 4294967295)
       and objid::bigint = (p_key & 4294967295));
$$;

create function pg_temp.requeue_old() returns int language plpgsql as $$
declare
  v int;
begin
  execute 'select private.requeue_unscrubbed_retained_deletions()' into v;
  return v;
exception when undefined_function then
  return null;
end $$;

-- This guard's own helpers are called while acting as other roles. A new
-- function is closed by default (architecture plan 2, item A3), so they are opened here.
grant execute on all routines in schema pg_temp to public;

do $$
declare
  leaver uuid := gen_random_uuid();      -- deletes their account, after trading
  other uuid := gen_random_uuid();       -- the member they traded and talked with
  claimant uuid := gen_random_uuid();    -- picks a handle
  queued uuid := gen_random_uuid();      -- scrubbed, job still in the queue
  plain uuid := gen_random_uuid();       -- not scrubbed: the old behaviour
  old_retained uuid := gen_random_uuid();   -- retained before the scrub existed
  old_no_job uuid := gen_random_uuid();     -- the same, with its job missing
  sold uuid := gen_random_uuid();
  queued_sale uuid := gen_random_uuid();
  plain_sale uuid := gen_random_uuid();
  old_sale uuid := gen_random_uuid();
  their_post uuid := gen_random_uuid();
  their_part uuid := gen_random_uuid();
  leaver_job uuid; leaver_lease uuid := gen_random_uuid();
  queued_job uuid; queued_lease uuid := gen_random_uuid();
  plain_job uuid;
  old_job uuid; old_lease uuid := gen_random_uuid();
  retained jsonb := jsonb_build_object(
    'blocker_code', 'immutable_retained_identity',
    'affected_data_classes', jsonb_build_array('orders'),
    'next_action', 'Personal data is removed. Order and payment keys are kept until the retention date.',
    'responsible_owner', 'operations and policy owner',
    'policy_decisions_pending', jsonb_build_array('audit/log retention'));
  r jsonb;
  gate jsonb;
  req public.account_deletion_requests%rowtype;
  n int;
  sent int;
  fails text[] := '{}';
begin
  insert into public.job_config (key, value) values ('payments_mode', 'stub')
    on conflict (key) do update set value = excluded.value;
  insert into auth.users (id, email, raw_user_meta_data) values
    (leaver, 'n418-leaver@drvn.test', '{}'), (other, 'n418-other@drvn.test', '{}'),
    (claimant, 'n418-claimant@drvn.test', '{}'), (queued, 'n418-queued@drvn.test', '{}'),
    (plain, 'n418-plain@drvn.test', '{}'), (old_retained, 'n418-old@drvn.test', '{}'),
    (old_no_job, 'n418-old-nojob@drvn.test', '{}');
  update public.profiles set username = 'n418_alice', display_name = 'Alice Leaver' where id = leaver;
  update public.profiles set username = 'n418_bob', display_name = 'Bob Other' where id = other;

  -- ---------- P: what the leaver wrote, as the other member's notifications copied it ----------
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, completed_at)
  values (sold, other, leaver, 'completed', 5000, 0, 500, 5000, 'USD', now() - interval '1 day');
  -- Bob's post is about his part (a published post needs a car or a part,
  -- checked here at each statement).
  insert into public.listings (id, seller_id, title, category, price_cents, status)
    values (their_part, other, 'Bob''s wheels', 'performance', 80000, 'active');
  insert into public.activity_posts (id, car_id, author_id, title, body, published_at)
    values (their_post, null, other, 'Bob''s update', '{"type":"doc","content":[]}', null);
  insert into public.activity_post_listings (post_id, listing_id, position) values (their_post, their_part, 0);
  update public.activity_posts set published_at = now() where id = their_post;
  insert into public.activity_comments (post_id, author_id, body) values (their_post, leaver, 'Great car, text me on 07123 456789');
  insert into public.listing_questions (listing_id, author_id, body) values (their_part, leaver, 'Still for sale? Call 07123 456789');
  insert into public.follows (follower_id, target_type, target_id) values (leaver, 'profile', other);
  -- A message notification as the legacy messages trigger wrote it, and an
  -- order notification in DRVN's own words.
  insert into public.notifications (user_id, kind, section, title, body, href, actor_id) values
    (other, 'message', 'marketplace', 'Message from Alice Leaver', 'My number is 07123 456789', '/orders/' || sold, leaver),
    (other, 'order_sold', 'marketplace', 'Order ' || left(sold::text, 8) || ' — dispatch when ready', null, '/orders/' || sold, leaver);
  if not exists (select 1 from public.notifications where user_id = other and kind = 'comment'
                  and body like '%07123 456789%' and title like 'Alice Leaver%')
     or not exists (select 1 from public.notifications where user_id = other and kind = 'question' and body like '%07123 456789%')
     or not exists (select 1 from public.notifications where user_id = other and kind = 'follow' and href = '/u/n418_alice') then
    raise exception 'Fixture: the comment, question and follow triggers did not notify the other member (N418)';
  end if;
  select count(*) into sent from public.notifications where actor_id = leaver;

  insert into public.remediation_jobs (kind, dedup_key, payload, status, lease_id, locked_until)
  values ('delete_account', 'delete:' || leaver, jsonb_build_object('user_id', leaver), 'processing', leaver_lease, now() + interval '5 minutes')
  returning id into leaver_job;
  insert into public.account_deletion_requests (user_id, job_id, outcome, next_action, responsible_owner)
  values (leaver, leaver_job, 'cleanup_pending', 'Automated cleanup is in progress.', 'privacy worker');

  r := public.scrub_deleted_account(leaver, null, null);

  -- K1: the scrub took the handle's lock (still held: it is transaction-level).
  if not pg_temp.holds_advisory(pg_temp.lock_key('n418_alice')) then
    fails := fails || 'FAIL K1: the scrub retired a handle without taking its per-handle lock (N418)'::text;
  end if;

  if exists (select 1 from public.notifications where user_id = other
              and (coalesce(title, '') || ' ' || coalesce(body, '')) ~* '(07123|456789|alice)') then
    fails := fails || format('FAIL P1: after A''s scrub, B''s notifications still hold A''s name or the phone number A wrote (%s) (N418)',
      (select string_agg(kind || ': ' || title || ' / ' || coalesce(body, ''), '; ') from public.notifications
        where user_id = other and (coalesce(title, '') || ' ' || coalesce(body, '')) ~* '(07123|456789|alice)'));
  end if;
  if exists (select 1 from public.notifications where actor_id = leaver) then
    fails := fails || 'FAIL P2: a notification still names the deleted member as its actor (N418)'::text;
  end if;
  if (select count(*) from public.notifications where user_id = other and kind in ('comment', 'question', 'follow', 'message', 'order_sold')) <> 5
     or (select title from public.notifications where user_id = other and kind = 'comment') <> 'A member who has since left DRVN commented on your update'
     or (select body from public.notifications where user_id = other and kind = 'comment') <> '(removed)'
     or (select href from public.notifications where user_id = other and kind = 'comment') is distinct from public.post_href(their_post)
     or (select href from public.notifications where user_id = other and kind = 'question') is distinct from '/listings/' || their_part
     or (select title from public.notifications where user_id = other and kind = 'message') <> 'Message from a member who has since left DRVN' then
    fails := fails || 'FAIL P3: the other member''s notifications were not kept with neutral text and their links (N418)'::text;
  end if;
  if (select href from public.notifications where user_id = other and kind = 'follow') is not null then
    fails := fails || 'FAIL P4: a notification still links to the deleted member''s retired handle (N418)'::text;
  end if;
  if (select title from public.notifications where user_id = other and kind = 'order_sold')
       is distinct from 'Order ' || left(sold::text, 8) || ' — dispatch when ready' then
    fails := fails || 'FAIL P5: an order notification lost the text DRVN wrote (N418)'::text;
  end if;
  if (r->>'notifications_sent')::int is distinct from sent
     or (public.scrub_deleted_account(leaver, null, null)->>'notifications_sent')::int is distinct from 0 then
    fails := fails || format('FAIL P6: the notification rewrite is not counted (%s of %s), or a second scrub found more (N418)', r->>'notifications_sent', sent);
  end if;

  -- K2: claiming a handle takes the same lock before reading tombstones.
  update public.profiles set username = 'n418_fresh_handle' where id = claimant;
  if not pg_temp.holds_advisory(pg_temp.lock_key('n418_fresh_handle')) then
    fails := fails || 'FAIL K2: a handle was claimed without taking its per-handle lock (N418)'::text;
  end if;
  if pg_temp.lock_key('N418_Fresh_Handle') is distinct from pg_temp.lock_key('n418_fresh_handle') then
    fails := fails || 'FAIL K3: the handle lock depends on letter case (N418)'::text;
  end if;

  -- ---------- L: a hold after the scrub ----------
  -- The leaver's case finishes as a retained trader, then the buyer's bank
  -- opens a chargeback on the completed sale.
  r := public.account_deletion_finalise(leaver_job, leaver_lease, leaver, retained);
  if r->>'outcome' is distinct from 'operator_attention'
     or (select status from public.remediation_jobs where id = leaver_job) <> 'completed' then
    raise exception 'Fixture L: the leaver''s case did not finish as retained (%) (N418)', r;
  end if;
  insert into public.stripe_dispute_journal (dispute_id, payment_reference, amount_cents, currency, state, last_event_id, last_event_created, order_ids)
  values ('dp_n418_late', 'pi_n418_late', 5000, 'usd', 'open', 'evt_n418_1', 1, array[sold]);
  select * into req from public.account_deletion_requests where user_id = leaver;
  if req.outcome <> 'operator_attention' or req.blocker_code is distinct from 'late_hold_after_scrub'
     or (select status from public.remediation_jobs where id = leaver_job) <> 'completed' then
    fails := fails || format('FAIL L1: a hold after the scrub left the case %s / %s with its job %s (pending for reinstatement), not with an operator as a late hold (N418)',
      req.outcome, req.blocker_code, (select status from public.remediation_jobs where id = leaver_job));
  elsif req.hold_order_id is distinct from sold
     or req.next_action not like 'Order ' || upper(left(sold::text, 8)) || ' has a bank chargeback%never restored%'
     or req.responsible_owner <> 'operations' or req.scrubbed_at is null or req.retain_until is null then
    fails := fails || format('FAIL L2: the late-hold case does not name its order and the operator''s step, or lost its scrub record (%s) (N418)', row_to_json(req));
  end if;

  -- A case still in the queue, scrubbed on an earlier pass, meets a hold.
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, completed_at)
  values (queued_sale, other, queued, 'completed', 5000, 0, 500, 5000, 'USD', now() - interval '1 day');
  insert into public.remediation_jobs (kind, dedup_key, payload, status, lease_id, locked_until)
  values ('delete_account', 'delete:' || queued, jsonb_build_object('user_id', queued), 'processing', queued_lease, now() + interval '5 minutes')
  returning id into queued_job;
  insert into public.account_deletion_requests (user_id, job_id, outcome, next_action, responsible_owner)
  values (queued, queued_job, 'cleanup_pending', 'Automated cleanup is in progress.', 'privacy worker');
  perform public.scrub_deleted_account(queued, null, null);
  insert into public.stripe_dispute_journal (dispute_id, payment_reference, amount_cents, currency, state, last_event_id, last_event_created, order_ids)
  values ('dp_n418_queued', 'pi_n418_queued', 5000, 'usd', 'open', 'evt_n418_2', 2, array[queued_sale]);
  gate := public.account_deletion_hold_gate(queued_job, queued_lease, queued);
  if not coalesce((gate->>'held')::boolean, false) or not coalesce((gate->>'scrubbed')::boolean, false) then
    fails := fails || format('FAIL L3: the gate did not say a held case is already scrubbed (%s) (N418)', gate);
  end if;
  r := public.account_deletion_finalise(queued_job, queued_lease, queued, retained);
  if not coalesce((r->>'held')::boolean, false) or not coalesce((r->>'scrubbed')::boolean, false) then
    fails := fails || format('FAIL L4: finalise did not say a held case is already scrubbed (%s) (N418)', r);
  end if;
  perform public.pause_account_deletion_hold(queued_job, queued_lease, queued);
  select * into req from public.account_deletion_requests where user_id = queued;
  if req.outcome <> 'operator_attention' or req.blocker_code is distinct from 'late_hold_after_scrub'
     or req.hold_order_id is distinct from queued_sale or req.responsible_owner <> 'operations' then
    fails := fails || format('FAIL L5: pausing a scrubbed case told the member to settle (%s / %s) instead of recording a late hold for an operator (N418)',
      req.outcome, req.blocker_code);
  end if;
  if (select status from public.remediation_jobs where id = queued_job) <> 'pending'
     or (select next_attempt_at from public.remediation_jobs where id = queued_job) <= now() then
    fails := fails || 'FAIL L6: a paused late-hold case lost its later recheck (N418)'::text;
  end if;

  -- The bank decides; the next pass finds nothing held and cleans up again.
  update public.stripe_dispute_journal set state = 'won' where dispute_id = 'dp_n418_queued';
  update public.remediation_jobs set status = 'processing', lease_id = queued_lease, locked_until = now() + interval '5 minutes'
   where id = queued_job;
  gate := public.account_deletion_hold_gate(queued_job, queued_lease, queued);
  if coalesce((gate->>'held')::boolean, true)
     or (select outcome from public.account_deletion_requests where user_id = queued) <> 'cleanup_pending'
     or (select blocker_code from public.account_deletion_requests where user_id = queued) is not null then
    fails := fails || format('FAIL L7: a settled late hold did not let the case finish its cleanup (%s) (N418)', gate);
  end if;

  -- Control: an unscrubbed finished case is still requeued for its member.
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, completed_at)
  values (plain_sale, other, plain, 'completed', 5000, 0, 500, 5000, 'USD', now() - interval '1 day');
  insert into public.remediation_jobs (kind, dedup_key, payload, status, completed_at)
  values ('delete_account', 'delete:' || plain, jsonb_build_object('user_id', plain), 'completed', now())
  returning id into plain_job;
  insert into public.account_deletion_requests (user_id, job_id, outcome, blocker_code, next_action, responsible_owner)
  values (plain, plain_job, 'operator_attention', 'immutable_retained_identity', 'x', 'operations and policy owner');
  insert into public.stripe_dispute_journal (dispute_id, payment_reference, amount_cents, currency, state, last_event_id, last_event_created, order_ids)
  values ('dp_n418_plain', 'pi_n418_plain', 5000, 'usd', 'open', 'evt_n418_3', 3, array[plain_sale]);
  if (select status from public.remediation_jobs where id = plain_job) <> 'pending'
     or (select outcome from public.account_deletion_requests where user_id = plain) <> 'temporary_financial_hold' then
    fails := fails || 'FAIL L8: an unscrubbed case was not requeued for its member as before (N418)'::text;
  end if;

  -- ---------- R: retained before the scrub existed ----------
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, completed_at)
  values (old_sale, other, old_retained, 'completed', 5000, 0, 500, 5000, 'USD', now() - interval '40 days');
  insert into public.remediation_jobs (kind, dedup_key, payload, status, completed_at, attempts)
  values ('delete_account', 'delete:' || old_retained, jsonb_build_object('user_id', old_retained, 'stripe_customer_id', null), 'completed', now() - interval '30 days', 3)
  returning id into old_job;
  insert into public.account_deletion_requests (user_id, job_id, outcome, blocker_code, next_action, responsible_owner) values
    (old_retained, old_job, 'operator_attention', 'immutable_retained_identity', 'An operator must apply the retention policy.', 'operations and policy owner'),
    (old_no_job, null, 'operator_attention', 'immutable_retained_identity', 'An operator must apply the retention policy.', 'operations and policy owner');

  n := pg_temp.requeue_old();
  if n is null or n < 2
     or (select status from public.remediation_jobs where id = old_job) <> 'pending'
     or (select attempts from public.remediation_jobs where id = old_job) <> 0
     or (select next_attempt_at from public.remediation_jobs where id = old_job) > now()
     or (select outcome from public.account_deletion_requests where user_id = old_retained) <> 'cleanup_pending' then
    fails := fails || format('FAIL R1: a deletion retained before the scrub existed (outcome operator_attention, never scrubbed) was not requeued (%s requeued) (N418)', n);
  end if;
  if not exists (select 1 from public.remediation_jobs j join public.account_deletion_requests r2 on r2.job_id = j.id
                  where r2.user_id = old_no_job and j.dedup_key = 'delete:' || old_no_job
                    and j.status = 'pending' and j.payload->>'user_id' = old_no_job::text) then
    fails := fails || 'FAIL R2: a retained case with no job was not given one (N418)'::text;
  end if;
  if (select status from public.remediation_jobs where id = leaver_job) <> 'completed'
     or (select scrubbed_at from public.account_deletion_requests where user_id = leaver) is null
     or (select outcome from public.account_deletion_requests where user_id = leaver) <> 'operator_attention' then
    fails := fails || 'FAIL R3: the requeue picked up a case that was already scrubbed (N418)'::text;
  end if;
  if pg_temp.requeue_old() is distinct from 0 then
    fails := fails || 'FAIL R4: a second requeue found more cases: it is not idempotent (N418)'::text;
  end if;

  -- The requeued case meets the normal checks first: a chargeback opened
  -- since pauses it for the member, as today, because nothing is erased yet.
  if (select status from public.remediation_jobs where id = old_job) = 'pending' then
    insert into public.stripe_dispute_journal (dispute_id, payment_reference, amount_cents, currency, state, last_event_id, last_event_created, order_ids)
    values ('dp_n418_old', 'pi_n418_old', 5000, 'usd', 'open', 'evt_n418_4', 4, array[old_sale]);
    update public.remediation_jobs set status = 'processing', lease_id = old_lease, locked_until = now() + interval '5 minutes'
     where id = old_job;
    gate := public.account_deletion_hold_gate(old_job, old_lease, old_retained);
    if not coalesce((gate->>'held')::boolean, false) or coalesce((gate->>'scrubbed')::boolean, true) then
      fails := fails || format('FAIL R5: the requeued case did not meet the hold gate as unscrubbed (%s) (N418)', gate);
    end if;
    perform public.pause_account_deletion_hold(old_job, old_lease, old_retained);
    if (select outcome from public.account_deletion_requests where user_id = old_retained) <> 'temporary_financial_hold' then
      fails := fails || 'FAIL R6: a held, unscrubbed requeued case did not pause for its member (N418)'::text;
    end if;
  end if;

  if to_regprocedure('private.record_account_deletion_late_hold(uuid,uuid)') is null
     or to_regprocedure('private.account_deletion_late_hold_note(uuid)') is null
     or to_regprocedure('private.requeue_unscrubbed_retained_deletions()') is null
     or to_regprocedure('private.username_lock_key(text)') is null then
    fails := fails || 'FAIL 9: the late-hold, requeue and handle-lock helpers are missing (N418)'::text;
  elsif has_function_privilege('authenticated', 'private.record_account_deletion_late_hold(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.account_deletion_late_hold_note(uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.requeue_unscrubbed_retained_deletions()', 'execute')
     or has_function_privilege('authenticated', 'private.username_lock_key(text)', 'execute')
     or has_function_privilege('anon', 'private.record_account_deletion_late_hold(uuid,uuid)', 'execute') then
    fails := fails || 'FAIL 10: a member or visitor can call the late-hold, requeue or handle-lock helpers (N418)'::text;
  end if;

  if cardinality(fails) > 0 then
    raise exception E'% check(s) failed (N418):\n%', cardinality(fails), array_to_string(fails, E'\n');
  end if;
  raise notice 'all deletion late hold and notification preview (N418) checks passed';
end $$;

rollback;
