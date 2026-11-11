-- 20261107200510 — a refused admin refund doesn't lock refunds on the order
-- (N134, OS-W14).
--
-- begin_admin_external_operation (20260905130628) fences one admin refund
-- per order: a request without a completion or reconciliation record blocks
-- the next one, so an answer lost between DRVN and Stripe can't turn into a
-- second refund. But every failure took that path, including refusals that
-- prove nothing was sent: "nothing left to refund", "no captured payment",
-- an invalid amount, Stripe declining to create the refund. Each one locked
-- refunds on the order until an operator reconciled it by hand, at least 15
-- minutes later.
--
-- release_refused_admin_refund closes a force-refund request as not applied
-- only when the durable records agree with the app's refusal:
--   * it takes the fence's own lock, so admission and reconciliation wait;
--   * every refund operation this request created (this admin's, on this
--     order, since the request — the same rule reconcile uses) is 'failed'
--     with no provider refund id. Anything else (still running, completed,
--     a provider refund that exists) leaves the fence closed for the
--     operator's reconciliation, as before;
--   * the closing record is the same terminal 'reconciled' / 'not_applied'
--     row reconcile_admin_external_operation writes, so the one-terminal
--     index (20261003130000) still allows exactly one answer, with the
--     refusal kept as its evidence.
-- Unknown outcomes (timeouts, lost answers, pending at Stripe) never come
-- here: the app only calls this for refusals it proved, and the fence holds
-- those for reconciliation exactly as before. Who is refunded, how much and
-- when are unchanged.

begin;

create or replace function public.release_refused_admin_refund(
  p_actor uuid,
  p_operation uuid,
  p_detail text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req public.admin_audit_log;
  v_ops jsonb;
  v_blocking int;
begin
  perform public.assert_admin_actor(p_actor);

  select * into v_req from public.admin_audit_log a
  where a.metadata->>'operationId' = p_operation::text
    and a.metadata->>'phase' = 'requested'
    and a.action = 'order.force_refund'
    and a.actor_id = p_actor
  order by a.id limit 1;
  if not found then
    raise exception 'No such refund request from this admin' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_req.action || ':' || v_req.subject_id::text, 0));

  if exists (
    select 1 from public.admin_audit_log a
    where a.metadata->>'operationId' = p_operation::text
      and a.metadata->>'phase' in ('completed', 'reconciled')
  ) then
    return jsonb_build_object('released', false, 'status', 'already_resolved');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'status', r.status, 'providerStatus', r.provider_status,
           'refundReference', r.refund_reference, 'amountCents', r.amount_cents)
           order by r.created_at), '[]'::jsonb),
         count(*) filter (where r.status <> 'failed' or r.refund_reference is not null)
    into v_ops, v_blocking
  from public.refund_operations r
  where r.order_id = v_req.subject_id
    and r.created_at >= v_req.created_at
    and r.requested_by = 'admin:' || v_req.actor_id::text;

  if v_blocking > 0 then
    return jsonb_build_object('released', false, 'status', 'refund_on_file', 'operations', v_ops);
  end if;

  insert into public.admin_audit_log(actor_id, action, subject_type, subject_id, order_id, reason, metadata)
  values (p_actor, 'operation.reconcile', v_req.subject_type, v_req.subject_id, v_req.order_id,
    left(coalesce(nullif(trim(p_detail), ''), 'Refund refused'), 4000),
    jsonb_build_object('operationId', p_operation::text, 'phase', 'reconciled', 'outcome', 'not_applied',
      'reconciles', v_req.action,
      'evidence', jsonb_build_object('source', 'refusal', 'detail', left(coalesce(p_detail, ''), 1000),
        'operations', v_ops, 'observedAt', now())));

  return jsonb_build_object('released', true, 'status', 'resolved', 'operations', v_ops);
end;
$$;

revoke all on function public.release_refused_admin_refund(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.release_refused_admin_refund(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;
