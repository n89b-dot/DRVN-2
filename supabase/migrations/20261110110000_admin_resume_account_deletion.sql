-- ============================================================================
-- 20261110110000 — an operator resumes a stuck account deletion without SQL
-- (report five #106, #108)
--
-- Two deletion states had no way out but raw SQL:
--   1. A late hold after the scrub on a case whose job had already finished
--      (late_hold_after_scrub via private.requeue_account_deletion_for_hold,
--      20261108180000). The job is completed on purpose, so no pass can give
--      sign-in back, which also means nothing rechecks once the order
--      settles: the case stays "needs an operator" forever.
--   2. A deletion job the worker gave up on (status 'failed' after ten
--      attempts): a Stripe customer that isn't the member's, a storage or
--      Auth failure.
-- public.admin_resume_account_deletion puts the case's job back in the queue
-- for the next pass, under the deletion lock, and only in those two shapes.
-- Everything still decides on the pass: the hold gate (a hold that remains
-- pauses it again, with the ban kept for a scrubbed case), the scrub, the
-- storage drain and finalise. It refuses, in words, a case on a member's own
-- financial hold, a retained-identity case (final until the retention ruling),
-- a job already queued or running, and a late-hold case whose hold is still
-- open.
--
-- Service role only; the console calls it through auditedAction, which
-- asserts the actor is a full admin first and journals the operation.
-- Idempotent (create or replace).
-- ============================================================================

begin;

create or replace function public.admin_resume_account_deletion(p_user uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.account_deletion_requests%rowtype;
  v_job public.remediation_jobs%rowtype;
  v_held boolean;
  v_shape text;
begin
  if p_user is null then raise exception 'Missing member' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(private.account_deletion_lock_key(p_user));

  select * into v_request from public.account_deletion_requests where user_id = p_user for update;
  if not found then raise exception 'This member has no deletion request' using errcode = 'P0002'; end if;
  if v_request.outcome = 'completed' then raise exception 'This deletion is already complete' using errcode = '22023'; end if;

  select * into v_job from public.remediation_jobs
   where dedup_key = 'delete:' || p_user::text and kind = 'delete_account'
   for update;
  if not found then raise exception 'This deletion has no job to resume' using errcode = 'P0002'; end if;
  if v_job.status in ('pending', 'processing') then
    raise exception 'This deletion is already queued or running; the worker picks it up on its next pass' using errcode = '22023';
  end if;

  v_held := coalesce((public.account_deletion_blockers(p_user)->>'financial_hold')::boolean, true);

  if v_job.status = 'failed' then
    v_shape := 'failed_job';
  elsif v_request.outcome = 'operator_attention' and v_request.blocker_code = 'late_hold_after_scrub' then
    if v_held then
      raise exception 'The order that holds this deletion is still open. Settle it first (refund, payout or chargeback), then resume' using errcode = '22023';
    end if;
    v_shape := 'late_hold_settled';
  elsif v_request.outcome = 'operator_attention' and v_request.blocker_code = 'immutable_retained_identity' then
    raise exception 'Nothing to resume: personal data is removed and the transaction keys are kept until the retention date' using errcode = '22023';
  elsif v_request.outcome = 'temporary_financial_hold' then
    raise exception 'The member settles this hold themselves; the worker rechecks it every hour' using errcode = '22023';
  else
    raise exception 'Nothing to resume in this state' using errcode = '22023';
  end if;

  -- The console asks first (p_dry_run), so a refusal is said in words before
  -- anything is journalled; the real call repeats every check under the lock.
  if not coalesce(p_dry_run, false) then
    update public.remediation_jobs
       set status = 'pending', next_attempt_at = now(), locked_until = null, lease_id = null,
           attempts = 0, last_error = null, completed_at = null
     where id = v_job.id;
  end if;

  return jsonb_build_object(
    'resumed', not coalesce(p_dry_run, false),
    'shape', v_shape,
    'previous_job_status', v_job.status,
    'previous_error', v_job.last_error,
    'outcome', v_request.outcome,
    'blocker_code', v_request.blocker_code,
    'still_held', v_held
  );
end $$;

revoke all on function public.admin_resume_account_deletion(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_resume_account_deletion(uuid, boolean) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.admin_resume_account_deletion(uuid, boolean)', 'execute')
     or has_function_privilege('anon', 'public.admin_resume_account_deletion(uuid, boolean)', 'execute') then
    raise exception '20261110110000: a member can resume deletions';
  end if;
  raise notice 'PASS: 20261110110000 self-checks';
end $$;

commit;
