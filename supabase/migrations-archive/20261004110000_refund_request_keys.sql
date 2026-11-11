-- 20261004110000 — one refund operation per business request.
--
-- begin_refund_operation creates a new operation on every call, keyed for
-- Stripe by the cumulative amount. Nothing tied an operation to the request
-- that caused it — a return, an accepted refund offer — so a caller that read
-- "not ok" as "nothing happened" could ask again and refund twice:
--   * a return whose refund Stripe answered `pending` stays `received`; the
--     return worker retries every pass, and for a partial return the
--     remaining balance still covers it, so a second operation (new key, new
--     Stripe refund) was created;
--   * a buyer accepting a refund offer whose refund came back pending or
--     uncertain got the offer back, and accepting again refunded again.
--
-- refund_operations.request_key names the business request. A live (not
-- failed) operation per key is unique, and begin_request_refund_operation
-- adopts it instead of creating another: the caller re-drives that same
-- operation (reconcile-before-retry does the rest). Only after Stripe refused
-- the earlier attempt (status failed) does the same request start a new one.
-- Requests are serialized per key, so concurrent deliveries can't race.
-- Idempotent.

begin;

alter table public.refund_operations add column if not exists request_key text;

create unique index if not exists refund_operations_live_request_key_idx
  on public.refund_operations (request_key)
  where request_key is not null and status <> 'failed';

create or replace function public.begin_request_refund_operation(
  p_request_key       text,
  p_order_id          uuid,
  p_amount_cents      int,
  p_reason            text,
  p_requested_by      text,
  p_actor_role        text,
  p_resolve_dispute   boolean,
  p_dispute_outcome   text,
  p_payment_reference text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing record;
  v_result jsonb;
begin
  if p_request_key is null or length(p_request_key) not between 1 and 200 then
    raise exception 'A refund request key is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('refund-request:' || p_request_key, 0));

  select id, status, order_id into v_existing
  from public.refund_operations
  where request_key = p_request_key and status <> 'failed'
  order by created_at desc
  limit 1;
  if found then
    if v_existing.order_id is distinct from p_order_id then
      raise exception 'Refund request key belongs to another order' using errcode = '22023';
    end if;
    return jsonb_build_object('ok', true, 'adopted', true,
      'operation_id', v_existing.id, 'status', v_existing.status);
  end if;

  v_result := public.begin_refund_operation(
    p_order_id, p_amount_cents, p_reason, p_requested_by, p_actor_role,
    p_resolve_dispute, p_dispute_outcome, p_payment_reference, null, false
  );
  if (v_result->>'ok')::boolean and not coalesce((v_result->>'adopted')::boolean, false) then
    update public.refund_operations
    set request_key = p_request_key
    where id = (v_result->>'operation_id')::uuid;
  end if;
  return v_result;
end;
$$;

revoke all on function public.begin_request_refund_operation(text, uuid, int, text, text, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_request_refund_operation(text, uuid, int, text, text, text, boolean, text, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
