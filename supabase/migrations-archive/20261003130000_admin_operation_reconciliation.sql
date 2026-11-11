-- 20261003130000 — reconciling a stuck admin operation is one checked,
-- authorized transition, not an annotation (R2-02, follows RR-15).
--
-- adminReconcileOperation used to read the operation's audit rows, see no
-- completion, then append a separate `phase: reconciled` row. Two operators
-- could both pass the read and record opposite answers, a provider
-- completion could land in between, and begin_admin_external_operation
-- (20260905130628) releases its fence on any reconciled row — so a note and
-- a yes/no choice were enough to unblock another refund on the same order,
-- whatever the money records said.
--
-- reconcile_admin_external_operation now:
--   * runs as the signed-in admin with a fresh MFA step-up — the same check
--     as execute_admin_command — and records them as the actor;
--   * takes the operation fence's own lock (action:subject), so admission,
--     reconciliation and other reconcilers serialize;
--   * refuses if the operation changed since the operator looked at it
--     (p_seen_through is the newest audit id they saw), replays an
--     identical answer that already committed, and reports a conflicting one;
--   * for refund operations, decides from the durable refund_operations
--     rows this request created: "applied" needs a refund whose effects
--     completed, "not applied" is refused while any refund from it exists or
--     is still running, and an operation still in flight can't be closed;
--   * won't record "not applied" within 15 minutes of the request, when its
--     provider call may still be running;
--   * keeps "unknown" as an escalation that does NOT release the fence.
-- A unique index makes a second terminal record for one operation
-- impossible, whichever writer gets there first.

begin;

-- One terminal record per operation: completion or reconciliation, never both.
create unique index if not exists admin_audit_log_operation_terminal_idx
  on public.admin_audit_log ((metadata->>'operationId'))
  where metadata->>'phase' in ('completed', 'reconciled');

create or replace function public.reconcile_admin_external_operation(
  p_operation uuid,
  p_seen_through bigint,
  p_outcome text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_req public.admin_audit_log;
  v_terminal public.admin_audit_log;
  v_latest bigint;
  v_order uuid;
  v_ops jsonb;
  v_running boolean := false;
  v_applied boolean := false;
  v_any boolean := false;
  v_evidence jsonb;
  v_lease constant interval := interval '15 minutes';
begin
  if not public.is_admin() or public.admin_role() <> 'admin' or not exists(
    select 1 from jsonb_array_elements(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->'amr', '[]'::jsonb)) m
    where m->>'method' in ('totp', 'mfa/totp')
      and (m->>'timestamp')::numeric between extract(epoch from now()) - 900 and extract(epoch from now()) + 60
  ) then
    raise exception 'Admin step-up required' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('applied', 'not_applied', 'unknown') then
    raise exception 'Outcome must be applied, not_applied or unknown' using errcode = '22023';
  end if;
  if p_reason is null or length(trim(p_reason)) < 1 or length(p_reason) > 4000 then
    raise exception 'A reason of 1–4000 characters is required' using errcode = '22023';
  end if;

  select * into v_req from public.admin_audit_log a
  where a.metadata->>'operationId' = p_operation::text and a.metadata->>'phase' = 'requested'
  order by a.id limit 1;
  if not found then raise exception 'No such operation' using errcode = 'P0002'; end if;

  -- The fence's own lock: admission of a new operation on this subject waits
  -- for us, and so does any other reconciler.
  perform pg_advisory_xact_lock(hashtextextended(v_req.action || ':' || v_req.subject_id::text, 0));

  select * into v_terminal from public.admin_audit_log a
  where a.metadata->>'operationId' = p_operation::text
    and a.metadata->>'phase' in ('completed', 'reconciled')
  order by a.id limit 1;
  if found then
    if v_terminal.metadata->>'phase' = 'reconciled' and v_terminal.metadata->>'outcome' = p_outcome then
      -- The same answer already committed (a lost response, a double click).
      return jsonb_build_object('status', 'resolved', 'outcome', p_outcome, 'replayed', true);
    end if;
    return jsonb_build_object(
      'status', 'already_resolved',
      'phase', v_terminal.metadata->>'phase',
      'outcome', v_terminal.metadata->>'outcome'
    );
  end if;

  select max(a.id) into v_latest from public.admin_audit_log a
  where a.metadata->>'operationId' = p_operation::text;
  if p_seen_through is null or v_latest > p_seen_through then
    raise exception 'This operation changed since you opened it; reload before recording'
      using errcode = '40001';
  end if;

  if p_outcome = 'unknown' then
    insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, order_id, reason, metadata)
    values (v_actor, 'operation.reconcile', v_req.subject_type, v_req.subject_id, v_req.order_id, p_reason,
      jsonb_build_object('operationId', p_operation::text, 'phase', 'escalated', 'outcome', 'unknown',
        'reconciles', v_req.action));
    return jsonb_build_object('status', 'escalated', 'outcome', 'unknown', 'replayed', false);
  end if;

  -- Which durable money records can answer for this operation?
  if v_req.action = 'order.force_refund' then
    v_order := v_req.subject_id;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'status', r.status, 'providerStatus', r.provider_status,
             'refundReference', r.refund_reference, 'amountCents', r.amount_cents)
             order by r.created_at), '[]'::jsonb),
           coalesce(bool_or(r.status in ('requested', 'provider_pending', 'provider_succeeded', 'effects_pending', 'recovery_required')), false),
           coalesce(bool_or(r.status in ('reversal_pending', 'completed')), false),
           count(*) > 0
      into v_ops, v_running, v_applied, v_any
    from public.refund_operations r
    where r.order_id = v_order
      and r.created_at >= v_req.created_at
      and r.requested_by = 'admin:' || v_req.actor_id::text;
  elsif v_req.action = 'recovery.replace_refund' then
    select pr.order_id into v_order from public.payment_recoveries pr where pr.id = v_req.subject_id;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'status', r.status, 'providerStatus', r.provider_status,
             'refundReference', r.refund_reference, 'amountCents', r.amount_cents)
             order by r.created_at), '[]'::jsonb),
           coalesce(bool_or(r.status in ('requested', 'provider_pending', 'provider_succeeded', 'effects_pending', 'recovery_required')), false),
           coalesce(bool_or(r.status in ('reversal_pending', 'completed')), false),
           count(*) > 0
      into v_ops, v_running, v_applied, v_any
    from public.refund_operations r
    where r.order_id = v_order
      and r.created_at >= v_req.created_at
      and r.replaces_adjustment_id is not null;
  end if;

  if v_order is not null then
    if v_running then
      raise exception 'A refund from this operation is still being processed. Let the payment worker finish it (or work its recovery case), then record the outcome.'
        using errcode = '55000';
    end if;
    if p_outcome = 'applied' and not v_applied then
      raise exception 'No completed refund from this operation is recorded. Check again, or record it as unknown so it stays blocked.'
        using errcode = '55000';
    end if;
    if p_outcome = 'not_applied' and v_applied then
      raise exception 'A completed refund from this operation is recorded. Record it as applied.'
        using errcode = '55000';
    end if;
    if p_outcome = 'not_applied' and not v_any and v_req.created_at > now() - v_lease then
      raise exception 'This operation was requested under 15 minutes ago and may still be running. Check again later.'
        using errcode = '55000';
    end if;
    v_evidence := jsonb_build_object('source', 'refund_operations', 'orderId', v_order,
      'operations', v_ops, 'observedAt', now());
  else
    if v_req.created_at > now() - v_lease then
      raise exception 'This operation was requested under 15 minutes ago and may still be running. Check again later.'
        using errcode = '55000';
    end if;
    v_evidence := jsonb_build_object('source', 'operator', 'observedAt', now(),
      'note', 'No durable money record is linked to this action; the outcome is the operator''s account.');
  end if;

  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, order_id, reason, metadata)
  values (v_actor, 'operation.reconcile', v_req.subject_type, v_req.subject_id, v_req.order_id, p_reason,
    jsonb_build_object('operationId', p_operation::text, 'phase', 'reconciled', 'outcome', p_outcome,
      'reconciles', v_req.action, 'evidence', v_evidence, 'seenThrough', p_seen_through));
  return jsonb_build_object('status', 'resolved', 'outcome', p_outcome, 'evidence', v_evidence, 'replayed', false);
end;
$$;

revoke all on function public.reconcile_admin_external_operation(uuid, bigint, text, text) from public, anon;
grant execute on function public.reconcile_admin_external_operation(uuid, bigint, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
