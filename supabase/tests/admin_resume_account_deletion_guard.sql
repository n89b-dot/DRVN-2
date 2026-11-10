-- 20261110110000 (report five #106/#108, OS id N944): an operator resumes a
-- stuck account deletion without SQL, and only in the two stuck shapes.
--   A  a late hold after the scrub on a finished case: refused while the
--      chargeback is open; once it settles, a dry run changes nothing and the
--      real call puts the job back in the queue
--   F  a job the worker gave up on: queued again with attempts reset
--   R  refused, in words: a member's own financial hold, a retained-identity
--      case, a job already queued, a completed deletion, no request
--   P  nobody but the service role can call it
-- Every failed check is collected and reported together at the end.
begin;

set constraints all immediate;

do $$
declare
  late uuid := gen_random_uuid();
  failed uuid := gen_random_uuid();
  retained uuid := gen_random_uuid();
  held uuid := gen_random_uuid();
  queued uuid := gen_random_uuid();
  done uuid := gen_random_uuid();
  buyer uuid := gen_random_uuid();
  nobody uuid := gen_random_uuid();
  sale uuid := gen_random_uuid();
  late_job uuid; failed_job uuid;
  r jsonb;
  msg text;
  fails text[] := '{}';
begin
  insert into public.job_config (key, value) values ('payments_mode', 'stub')
    on conflict (key) do update set value = excluded.value;
  insert into auth.users (id, email, raw_user_meta_data) values
    (late, 'n944-late@drvn.test', '{}'), (failed, 'n944-failed@drvn.test', '{}'), (retained, 'n944-retained@drvn.test', '{}'),
    (held, 'n944-held@drvn.test', '{}'), (queued, 'n944-queued@drvn.test', '{}'),
    (done, 'n944-done@drvn.test', '{}'), (buyer, 'n944-buyer@drvn.test', '{}');

  -- A: a scrubbed seller whose case finished, then a chargeback on their sale.
  insert into public.orders (id, buyer_id, seller_id, status, subtotal_cents, shipping_cents, platform_fee_cents, total_cents, currency, completed_at)
  values (sale, buyer, late, 'completed', 5000, 0, 500, 5000, 'USD', now() - interval '1 day');
  insert into public.remediation_jobs (kind, dedup_key, payload, status, completed_at)
  values ('delete_account', 'delete:' || late, jsonb_build_object('user_id', late), 'completed', now())
  returning id into late_job;
  insert into public.account_deletion_requests (user_id, job_id, outcome, blocker_code, next_action, responsible_owner, scrubbed_at)
  values (late, late_job, 'operator_attention', 'immutable_retained_identity', 'Personal data is removed.', 'operations and policy owner', now());
  insert into public.stripe_dispute_journal (dispute_id, payment_reference, amount_cents, currency, state, last_event_id, last_event_created, order_ids)
  values ('dp_n944', 'pi_n944', 5000, 'usd', 'open', 'evt_n944_1', 1, array[sale]);
  if (select blocker_code from public.account_deletion_requests where user_id = late) is distinct from 'late_hold_after_scrub' then
    raise exception 'Fixture A: the chargeback did not mark the finished case as a late hold (N944)';
  end if;

  begin
    perform public.admin_resume_account_deletion(late, false);
    fails := fails || 'FAIL A1: a late-hold case was resumed while its chargeback is still open (N944)'::text;
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like '%still open%' then fails := fails || format('FAIL A1b: the refusal did not say the order is still open (%s) (N944)', msg); end if;
  end;

  update public.stripe_dispute_journal set state = 'won' where dispute_id = 'dp_n944';
  r := public.admin_resume_account_deletion(late, true);
  if (r->>'resumed')::boolean or r->>'shape' is distinct from 'late_hold_settled'
     or (select status from public.remediation_jobs where id = late_job) <> 'completed' then
    fails := fails || format('FAIL A2: a dry run changed the job or misread the case (%s) (N944)', r);
  end if;
  r := public.admin_resume_account_deletion(late, false);
  if not (r->>'resumed')::boolean
     or (select status from public.remediation_jobs where id = late_job) <> 'pending'
     or (select attempts from public.remediation_jobs where id = late_job) <> 0
     or (select next_attempt_at from public.remediation_jobs where id = late_job) > now() then
    fails := fails || format('FAIL A3: the settled late hold was not queued again (%s) (N944)', r);
  end if;

  -- F: a job the worker gave up on.
  insert into public.remediation_jobs (kind, dedup_key, payload, status, attempts, last_error)
  values ('delete_account', 'delete:' || failed, jsonb_build_object('user_id', failed), 'failed', 10, 'Customer ownership requires operator review')
  returning id into failed_job;
  insert into public.account_deletion_requests (user_id, job_id, outcome, next_action, responsible_owner)
  values (failed, failed_job, 'cleanup_pending', 'Automated cleanup is in progress.', 'privacy worker');
  r := public.admin_resume_account_deletion(failed, false);
  if r->>'shape' is distinct from 'failed_job' or r->>'previous_error' is distinct from 'Customer ownership requires operator review'
     or (select status from public.remediation_jobs where id = failed_job) <> 'pending'
     or (select attempts from public.remediation_jobs where id = failed_job) <> 0
     or (select last_error from public.remediation_jobs where id = failed_job) is not null then
    fails := fails || format('FAIL F1: a failed deletion job was not queued again with its attempts reset (%s) (N944)', r);
  end if;

  -- R: everything else is refused and left as it was.
  insert into public.remediation_jobs (kind, dedup_key, payload, status, completed_at) values
    ('delete_account', 'delete:' || retained, jsonb_build_object('user_id', retained), 'completed', now()),
    ('delete_account', 'delete:' || held, jsonb_build_object('user_id', held), 'completed', now()),
    ('delete_account', 'delete:' || queued, jsonb_build_object('user_id', queued), 'pending', null),
    ('delete_account', 'delete:' || done, jsonb_build_object('user_id', done), 'completed', now());
  insert into public.account_deletion_requests (user_id, outcome, blocker_code, next_action, responsible_owner, scrubbed_at) values
    (retained, 'operator_attention', 'immutable_retained_identity', 'Personal data is removed.', 'operations and policy owner', now()),
    (held, 'temporary_financial_hold', null, 'Finish your open orders.', 'account owner', null),
    (queued, 'cleanup_pending', null, 'Automated cleanup is in progress.', 'privacy worker', null),
    (done, 'completed', null, 'No further action is required.', null, null);
  for r in select jsonb_build_object('user', u, 'expect', e) from (values
      (retained, 'retention date'), (held, 'rechecks it every hour'), (queued, 'already queued'),
      (done, 'already complete'), (nobody, 'no deletion request')) as t(u, e) loop
    begin
      perform public.admin_resume_account_deletion((r->>'user')::uuid, false);
      fails := fails || format('FAIL R1: a deletion was resumed that should be refused (%s) (N944)', r->>'expect');
    exception when others then
      get stacked diagnostics msg = message_text;
      if msg not like '%' || (r->>'expect') || '%' then
        fails := fails || format('FAIL R2: the refusal for "%s" said "%s" (N944)', r->>'expect', msg);
      end if;
    end;
  end loop;
  if (select status from public.remediation_jobs where dedup_key = 'delete:' || retained) <> 'completed'
     or (select status from public.remediation_jobs where dedup_key = 'delete:' || held) <> 'completed' then
    fails := fails || 'FAIL R3: a refused resume changed the job (N944)'::text;
  end if;

  -- P: service role only.
  if has_function_privilege('authenticated', 'public.admin_resume_account_deletion(uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'public.admin_resume_account_deletion(uuid, boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.admin_resume_account_deletion(uuid, boolean)', 'execute') then
    fails := fails || 'FAIL P1: resuming a deletion is not service-role only (N944)'::text;
  end if;

  if cardinality(fails) > 0 then
    raise exception '%', array_to_string(fails, E'\n');
  end if;
  raise notice 'all admin deletion resume checks passed';
end $$;

rollback;
