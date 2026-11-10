-- ============================================================================
-- 20261111080000 — Resume deletion checks the admin in the database
-- (follow-up owed from the review of #198; report five #106, N944)
--
-- public.admin_resume_account_deletion (20261110110000) took the member and
-- nothing else. It is service role only, and the console checks the admin
-- before it calls, so nothing was open. But every other function an operator
-- acts through names the admin and has the database check them
-- (public.assert_admin_actor, 0040), so a second caller holding the service
-- role could not skip the check. This one could be called with no admin
-- named at all.
--
-- The function now takes the acting admin first and refuses anyone who is
-- not a full admin, before it looks at the member, on a dry run too. Nothing
-- else in it changes: the body below is 20261110110000's, line for line,
-- after the first statement.
--
-- The two-argument function is dropped, not kept beside the new one: kept, it
-- would be the way round the check. So the app from the same pull request
-- must deploy with this migration; the older app's Resume deletion fails
-- ("function not found") against a database that has it, and changes nothing.
--
-- Idempotent: the drops are "if exists" and the new function is dropped
-- before it is created.
-- ============================================================================

begin;

drop function if exists public.admin_resume_account_deletion(uuid, boolean);
drop function if exists public.admin_resume_account_deletion(uuid, uuid, boolean);

create function public.admin_resume_account_deletion(p_actor uuid, p_user uuid, p_dry_run boolean default false)
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
  -- The database's own check that the caller acts for a full admin. Before
  -- anything else, the dry run included: a refusal's words describe a
  -- member's deletion, and are for an admin to read.
  perform public.assert_admin_actor(p_actor);
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

revoke all on function public.admin_resume_account_deletion(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_resume_account_deletion(uuid, uuid, boolean) to service_role;

commit;
