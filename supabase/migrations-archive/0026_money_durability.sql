-- ============================================================================
-- 0026 — Money durability: refund operations, transfer leases, alert outbox
--
-- Three crash-window closures on the money paths:
--
--   * refund_operations — refunds get the durable operation record transfers
--     already had (0019). Previously `orders.refunded_cents` was both the
--     ledger AND the concurrency lock: a crash between the compare-and-swap
--     and the Stripe call (or between Stripe succeeding and the bookkeeping)
--     left money state permanently wrong with nothing recorded to resume.
--     Now: begin_refund_operation() reserves the amount under a row lock
--     (in-flight operations count against the refundable remainder), the app
--     walks the operation through explicit states, and
--     settle_refund_operation() applies ALL internal bookkeeping in one
--     transaction. The orders columns remain the settled ledger — advanced
--     only at settle time, never used as a mutex again.
--
--   * transfer_intents leasing — the worker used to bulk-flip every runnable
--     row to 'processing' with no lease; one crash stranded the whole queue
--     forever ('processing' was never re-claimed). claim_transfer_intents()
--     claims a bounded batch under FOR UPDATE SKIP LOCKED with a worker id
--     and an expiring lease; expired leases are reclaimed automatically, so
--     a crashed worker's rows return to the pool instead of vanishing.
--
--   * admin_alert_outbox — alerts were fire-and-forget; a dispute could be
--     stamped "alerted" after a delivery that returned 500. Alerts are now
--     durable rows: enqueue is the commitment, delivery is retried with
--     backoff, dedup keys stop repeats, and an unset destination is recorded
--     as 'disabled' rather than pretended delivered.
--
-- All new tables are service-role-written; admins read via is_admin() (0018).
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ============================================================
-- 1. refund_operations — a refund is a durable operation
-- ============================================================
create table if not exists public.refund_operations (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references public.orders (id) on delete cascade,
  payment_reference      text,                    -- Stripe PaymentIntent (pi_…)
  amount_cents           int not null check (amount_cents > 0),
  currency               text not null,
  remaining_before_cents int not null,            -- refundable remainder at claim time
  reason                 text not null default '',
  requested_by           text not null,           -- initiator label (admin:…, buyer:…, stripe:…)
  actor_role             text not null default 'system',
  idempotency_key        text not null unique,    -- sent to Stripe verbatim
  refund_reference       text,                    -- Stripe refund (re_…)
  reversal_reference     text,                    -- Stripe transfer reversal (trr_…)
  reversal_due_cents     int,                     -- frozen at settle time; what reversal owes
  status                 text not null default 'requested' check (status in (
                           'requested',          -- reserved, Stripe not yet called
                           'provider_pending',   -- Stripe call in flight (crash re-entry point)
                           'provider_succeeded', -- refund exists at Stripe, effects not applied
                           'effects_pending',    -- settle in progress / retryable
                           'reversal_pending',   -- bookkeeping done, seller reversal owed
                           'completed',          -- everything applied
                           'failed',             -- Stripe refused; reservation released
                           'recovery_required'   -- human needed; payment_recoveries row open
                         )),
  external               boolean not null default false, -- originated at Stripe, not by us
  resolve_dispute        boolean not null default false,
  dispute_outcome        text,
  attempts               int not null default 0,
  next_attempt_at        timestamptz,
  last_error             text,
  recovery_id            uuid references public.payment_recoveries (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  provider_completed_at  timestamptz,
  effects_completed_at   timestamptz,
  reversal_completed_at  timestamptz
);

-- One operation per Stripe refund object — the webhook adopts, never duplicates.
create unique index if not exists refund_operations_refund_ref_idx
  on public.refund_operations (refund_reference) where refund_reference is not null;
create index if not exists refund_operations_order_idx
  on public.refund_operations (order_id);
-- The resume sweep scans these.
create index if not exists refund_operations_incomplete_idx
  on public.refund_operations (updated_at)
  where status in ('requested', 'provider_pending', 'provider_succeeded',
                   'effects_pending', 'reversal_pending');

alter table public.refund_operations enable row level security;

drop policy if exists "admins read refund operations" on public.refund_operations;
create policy "admins read refund operations" on public.refund_operations for select
  using (public.is_admin());

revoke all on public.refund_operations from anon, authenticated;
grant select on public.refund_operations to authenticated;

-- ------------------------------------------------------------
-- begin_refund_operation() — atomic reservation
-- ------------------------------------------------------------
-- The refundable remainder is total − settled − in-flight reservations, read
-- under a lock on the order row, so concurrent refunds can never oversubscribe
-- and the ledger column is never used as a mutex. `p_refund_reference` set
-- (external refund already made at Stripe) adopts-or-creates: a second webhook
-- delivery for the same re_… returns the existing operation.
create or replace function public.begin_refund_operation(
  p_order_id         uuid,
  p_amount_cents     int,            -- null = everything still refundable
  p_reason           text,
  p_requested_by     text,
  p_actor_role       text,
  p_resolve_dispute  boolean,
  p_dispute_outcome  text,
  p_payment_reference text,
  p_refund_reference text default null,
  p_external boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order     record;
  v_inflight  int;
  v_remaining int;
  v_amount    int;
  v_existing  record;
  v_op        public.refund_operations;
  v_key       text;
  v_failed    int;
begin
  -- Adopt an operation we already hold for this Stripe refund object.
  if p_refund_reference is not null then
    select id, status into v_existing
    from public.refund_operations
    where refund_reference = p_refund_reference;
    if found then
      return jsonb_build_object('ok', true, 'adopted', true,
        'operation_id', v_existing.id, 'status', v_existing.status);
    end if;
  end if;

  select id, total_cents, refunded_cents, currency
    into v_order
    from public.orders where id = p_order_id
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Order not found.');
  end if;

  select coalesce(sum(amount_cents), 0) into v_inflight
  from public.refund_operations
  where order_id = p_order_id
    and status in ('requested', 'provider_pending', 'provider_succeeded',
                   'effects_pending', 'reversal_pending', 'recovery_required');

  v_remaining := v_order.total_cents - v_order.refunded_cents - v_inflight;
  v_amount := coalesce(p_amount_cents, v_remaining);

  -- External refunds already happened at Stripe: book what's still bookable
  -- rather than refusing (stale webhook views can over-ask harmlessly).
  if p_external then
    v_amount := least(v_amount, v_remaining);
  end if;

  if v_amount <= 0 or v_remaining <= 0 then
    return jsonb_build_object('ok', false,
      'error', 'Nothing left to refund on this order (settled or in flight).');
  end if;
  if v_amount > v_remaining then
    return jsonb_build_object('ok', false,
      'error', 'Refund exceeds what''s left to refund on this order.');
  end if;

  -- Cumulative-deterministic (settled + reserved + this), so a crash-retry of
  -- the same in-flight operation reuses the key. A NEW operation after a
  -- terminally FAILED one at the same amount would collide (failed ops release
  -- their reservation but keep their key row) — those get a deterministic
  -- retry suffix: Stripe refused the previous request, so the retry is a new
  -- logical attempt and must not replay the refused call's key.
  v_key := 'refund:order:' || p_order_id || ':' || (v_order.refunded_cents + v_inflight + v_amount);
  select count(*) into v_failed
  from public.refund_operations
  where order_id = p_order_id and status = 'failed';
  if v_failed > 0 then
    v_key := v_key || ':r' || v_failed;
  end if;

  insert into public.refund_operations (
    order_id, payment_reference, amount_cents, currency, remaining_before_cents,
    reason, requested_by, actor_role, idempotency_key, refund_reference,
    status, external, resolve_dispute, dispute_outcome, provider_completed_at
  ) values (
    p_order_id, p_payment_reference, v_amount, v_order.currency, v_remaining,
    left(coalesce(p_reason, ''), 500), p_requested_by, p_actor_role,
    v_key,
    p_refund_reference,
    -- External refunds already exist at the provider — they enter the machine
    -- at effects_pending; app-initiated ones start at requested.
    case when p_external then 'effects_pending' else 'requested' end,
    p_external,
    coalesce(p_resolve_dispute, false),
    p_dispute_outcome,
    case when p_external then now() end
  ) returning * into v_op;

  return jsonb_build_object('ok', true, 'adopted', false,
    'operation_id', v_op.id, 'idempotency_key', v_op.idempotency_key,
    'amount_cents', v_op.amount_cents, 'status', v_op.status);
end;
$$;

revoke all on function public.begin_refund_operation(uuid, int, text, text, text, boolean, text, text, text, boolean) from public, anon, authenticated;

-- ------------------------------------------------------------
-- settle_refund_operation() — all internal effects, one transaction
-- ------------------------------------------------------------
-- Runs once the refund EXISTS at the provider. Advances the settled ledger,
-- reconciles the fee, updates the payment row, resolves dispute bookkeeping,
-- cancels pending transfer intents on full refund, and freezes the seller
-- reversal owed (reversal_due_cents) so the app's Stripe reversal call works
-- from a fixed figure. Idempotent: only transitions from
-- provider_succeeded/effects_pending; a replay on any later state is a no-op
-- that reports the current state.
create or replace function public.settle_refund_operation(p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_op        public.refund_operations;
  v_order     record;
  v_payment   record;
  v_before    int;
  v_after     int;
  v_fully     boolean;
  v_transfer  int;   -- seller share of the order (total − fee)
  v_rev_due   int;
  v_fee_after int;
  v_next      text;
begin
  select * into v_op from public.refund_operations
    where id = p_operation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Operation not found.');
  end if;
  if v_op.status not in ('provider_succeeded', 'effects_pending') then
    return jsonb_build_object('ok', true, 'already', true, 'status', v_op.status,
      'reversal_due_cents', coalesce(v_op.reversal_due_cents, 0),
      'fee_refunded_delta', 0);
  end if;

  select id, status, total_cents, platform_fee_cents, refunded_cents,
         platform_fee_refunded_cents, transfer_reference, pre_dispute_status,
         currency
    into v_order
    from public.orders where id = v_op.order_id
    for update;

  v_before := v_order.refunded_cents;
  v_after  := least(v_before + v_op.amount_cents, v_order.total_cents);
  v_fully  := v_after >= v_order.total_cents;

  -- Seller reversal owed, cumulative-deterministic (matches
  -- reversalShareCents in lib/payments/refunds.ts).
  v_transfer := v_order.total_cents - v_order.platform_fee_cents;
  if v_order.transfer_reference is not null and v_transfer > 0 and v_order.total_cents > 0 then
    v_rev_due := least(v_transfer, round((v_after::numeric * v_transfer) / v_order.total_cents))
               - least(v_transfer, round((v_before::numeric * v_transfer) / v_order.total_cents));
  else
    v_rev_due := 0;
  end if;

  v_fee_after := least(v_order.platform_fee_cents,
    round((v_after::numeric * v_order.platform_fee_cents) / greatest(v_order.total_cents, 1)));

  update public.orders o
  set refunded_cents = v_after,
      platform_fee_refunded_cents = v_fee_after,
      refunded_at = now(),
      status = case when v_fully then 'refunded'
                    when v_op.resolve_dispute and o.status = 'disputed'
                      then coalesce(v_order.pre_dispute_status, 'delivered')
                    else o.status end,
      cancelled_at = case when v_fully then now() else o.cancelled_at end,
      cancel_reason = case when v_fully then left(v_op.reason, 500) else o.cancel_reason end,
      dispute_resolved_at = case when v_op.resolve_dispute and o.status = 'disputed'
                                 then now() else o.dispute_resolved_at end,
      refund_offer_cents = case when v_op.resolve_dispute and o.status = 'disputed'
                                then null else o.refund_offer_cents end,
      refund_offered_at = case when v_op.resolve_dispute and o.status = 'disputed'
                               then null else o.refund_offered_at end,
      dispute_outcome = case when v_op.resolve_dispute and o.status = 'disputed'
                             then v_op.dispute_outcome else o.dispute_outcome end
  where o.id = v_op.order_id;

  select id, amount_cents, refunded_cents into v_payment
    from public.payments where order_id = v_op.order_id
    limit 1;
  if found then
    update public.payments
    set refunded_cents = coalesce(v_payment.refunded_cents, 0) + v_op.amount_cents,
        status = case when coalesce(v_payment.refunded_cents, 0) + v_op.amount_cents
                           >= v_payment.amount_cents
                      then 'refunded' else 'partially_refunded' end
    where id = v_payment.id;
  end if;

  if v_fully then
    update public.transfer_intents
    set status = 'cancelled', last_error = 'order fully refunded', updated_at = now()
    where order_id = v_op.order_id
      and status in ('holding', 'ready', 'blocked_unpayable', 'failed', 'processing');
  end if;

  v_next := case when v_rev_due > 0 then 'reversal_pending' else 'completed' end;

  update public.refund_operations
  set status = v_next,
      reversal_due_cents = v_rev_due,
      effects_completed_at = now(),
      reversal_completed_at = case when v_rev_due > 0 then null else now() end,
      updated_at = now()
  where id = p_operation_id;

  return jsonb_build_object('ok', true, 'already', false, 'status', v_next,
    'reversal_due_cents', v_rev_due,
    'transfer_reference', v_order.transfer_reference,
    'fully_refunded', v_fully,
    'refunded_after_cents', v_after,
    'fee_refunded_delta', v_fee_after - v_order.platform_fee_refunded_cents);
end;
$$;

revoke all on function public.settle_refund_operation(uuid) from public, anon, authenticated;

-- ============================================================
-- 2. transfer_intents — leases and scheduled retry
-- ============================================================
alter table public.transfer_intents
  add column if not exists locked_at        timestamptz,
  add column if not exists locked_by        text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists next_attempt_at  timestamptz,
  add column if not exists last_attempt_at  timestamptz;

create index if not exists transfer_intents_claimable_idx
  on public.transfer_intents (next_attempt_at)
  where status in ('ready', 'blocked_unpayable', 'failed', 'processing');

-- ------------------------------------------------------------
-- claim_transfer_intents() — bounded, leased, concurrency-safe
-- ------------------------------------------------------------
-- FOR UPDATE SKIP LOCKED so parallel workers partition the queue instead of
-- colliding. Claims: runnable rows whose backoff has elapsed, PLUS 'processing'
-- rows whose lease expired — the stale-claim recovery that makes a worker
-- crash a delay instead of a permanent stall.
create or replace function public.claim_transfer_intents(
  p_worker        text,
  p_batch         int default 20,
  p_lease_seconds int default 300,
  p_max_attempts  int default 8
) returns setof public.transfer_intents
language sql
security definer
set search_path = public, pg_temp
as $$
  with candidates as (
    select order_id from public.transfer_intents
    where (
        status in ('ready', 'blocked_unpayable', 'failed')
        and attempts < p_max_attempts
        and (next_attempt_at is null or next_attempt_at <= now())
      )
      or (
        status = 'processing'
        and (lease_expires_at is null or lease_expires_at < now())
      )
    order by updated_at
    limit greatest(p_batch, 1)
    for update skip locked
  )
  update public.transfer_intents ti
  set status = 'processing',
      locked_at = now(),
      locked_by = p_worker,
      lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
      last_attempt_at = now(),
      updated_at = now()
  from candidates c
  where ti.order_id = c.order_id
  returning ti.*;
$$;

revoke all on function public.claim_transfer_intents(text, int, int, int) from public, anon, authenticated;

-- ============================================================
-- 3. admin_alert_outbox — alerts are rows, not fetches
-- ============================================================
create table if not exists public.admin_alert_outbox (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,
  title           text not null,
  detail          text,
  order_id        uuid,
  amount_cents    int,
  payload         jsonb not null default '{}'::jsonb,
  dedup_key       text unique,        -- null = never deduped
  status          text not null default 'pending' check (status in (
                    'pending',    -- awaiting delivery (or retry)
                    'delivered',  -- destination acknowledged (2xx)
                    'failed',     -- attempts exhausted; visible in ops queue
                    'disabled'    -- no destination configured when created
                  )),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz
);

create index if not exists admin_alert_outbox_pending_idx
  on public.admin_alert_outbox (next_attempt_at) where status = 'pending';
create index if not exists admin_alert_outbox_created_idx
  on public.admin_alert_outbox (created_at);

alter table public.admin_alert_outbox enable row level security;

drop policy if exists "admins read alert outbox" on public.admin_alert_outbox;
create policy "admins read alert outbox" on public.admin_alert_outbox for select
  using (public.is_admin());

revoke all on public.admin_alert_outbox from anon, authenticated;
grant select on public.admin_alert_outbox to authenticated;

-- ============================================================
-- 4. Self-checks
-- ============================================================
do $$
begin
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('refund_operations', 'admin_alert_outbox')
      and grantee in ('anon', 'authenticated')
      and privilege_type <> 'SELECT'
  ) then
    raise exception 'SELF-CHECK FAILED: durability tables writable by client roles';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transfer_intents'
      and column_name = 'lease_expires_at'
  ) then
    raise exception 'SELF-CHECK FAILED: transfer lease columns missing';
  end if;
  raise notice 'PASS: 0026 self-checks';
end $$;

commit;
