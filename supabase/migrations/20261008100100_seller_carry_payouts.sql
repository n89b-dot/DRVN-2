-- 20261008100100 — a seller's carry-forward credit is paid out.
--
-- seller_carry_entries (20261005110100) records charges an order's own payout
-- didn't settle, and credits: a label refunded after its order's payout went,
-- a late label voided. A charge comes off the seller's next transfer. A
-- credit only ever offset later charges — a seller left in credit, with no
-- further label costs, was never sent the money.
--
-- What's added:
--
-- 1. seller_carry_payouts — one row per payment of a credit balance, with the
--    lease, attempt and dispatch fields a worker needs to send it exactly
--    once. At most one unfinished payout per seller.
--
-- 2. open_seller_carry_payouts — for each seller whose entries sum to more
--    than zero and whose newest entry is at least a day old, opens a payout
--    for the whole balance and, in the same transaction, writes a `paid_out`
--    entry for minus that amount. The balance is zero from that moment, so
--    nothing else (a later transfer's collection, a second run) can count the
--    same credit. The day's wait lets a label that is voided and bought again
--    net out first instead of being paid and then owed back.
--
-- 3. The worker's functions: claim (lease), prepare (freezes the destination
--    and records that Stripe may have been called), complete, release. A
--    payout cancelled before any Stripe call writes `paid_out_reversed`, which
--    puts the credit back; after a call it can't be cancelled, only completed
--    or left failed for an operator.
--
-- A charge recorded after a payout opened is simply owed again and comes off
-- the next transfer, as before.
--
-- Idempotent: if-not-exists, create or replace, drop-then-create.

begin;

-- ---------------------------------------------------------------------------
-- 1. Two more kinds of entry
-- ---------------------------------------------------------------------------

alter table public.seller_carry_entries drop constraint if exists seller_carry_entries_kind_check;
alter table public.seller_carry_entries add constraint seller_carry_entries_kind_check
  check (kind in (
    'uncollected', 'late_adjustment', 'adjustment_void',
    'uncollected_reversed', 'collected', 'reversal_shortfall',
    'paid_out', 'paid_out_reversed'
  ));

alter table public.seller_carry_entries drop constraint if exists seller_carry_entries_sign;
alter table public.seller_carry_entries add constraint seller_carry_entries_sign
  check (
    (kind in ('uncollected', 'reversal_shortfall', 'paid_out') and amount_cents < 0)
    or (kind in ('collected', 'paid_out_reversed') and amount_cents > 0)
    or kind in ('late_adjustment', 'adjustment_void', 'uncollected_reversed')
  );

-- ---------------------------------------------------------------------------
-- 2. The payouts
-- ---------------------------------------------------------------------------

create table if not exists public.seller_carry_payouts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references public.profiles(id) on delete set null,
  amount_cents int not null check (amount_cents > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  attempts int not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  locked_by text,
  lease_expires_at timestamptz,
  -- Frozen when the worker first prepares the dispatch; a retry sends to the
  -- same Stripe account even if the seller has since connected another.
  destination text,
  provider_call_may_have_occurred boolean not null default false,
  transfer_reference text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists seller_carry_payouts_one_open_idx
  on public.seller_carry_payouts (seller_id)
  where status in ('pending', 'processing', 'failed');
create index if not exists seller_carry_payouts_seller_idx
  on public.seller_carry_payouts (seller_id, created_at);

alter table public.seller_carry_payouts enable row level security;
drop policy if exists "seller reads own carry payouts" on public.seller_carry_payouts;
create policy "seller reads own carry payouts" on public.seller_carry_payouts
  for select using (seller_id = auth.uid() or public.is_admin());
revoke all on public.seller_carry_payouts from public, anon, authenticated;
-- The Stripe account, transfer reference and worker fields stay server-side.
grant select (id, seller_id, amount_cents, currency, status, paid_at, created_at)
  on public.seller_carry_payouts to authenticated;
grant all on public.seller_carry_payouts to service_role;

create or replace function public.open_seller_carry_payouts(
  p_quiet_hours int default 24,
  p_limit int default 50
) returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate record;
  v_balance int;
  v_latest timestamptz;
  v_payout uuid;
  v_opened int := 0;
  v_quiet interval := make_interval(hours => greatest(coalesce(p_quiet_hours, 24), 0));
begin
  for v_candidate in
    select e.seller_id
      from public.seller_carry_entries e
     where e.seller_id is not null
     group by e.seller_id
    having sum(e.amount_cents) > 0 and max(e.created_at) <= now() - v_quiet
     order by max(e.created_at)
     limit greatest(1, least(coalesce(p_limit, 50), 500))
  loop
    -- The lock every writer and every transfer's freeze takes: the balance
    -- read below can't change until this transaction commits.
    perform pg_advisory_xact_lock(hashtextextended('seller-carry:' || v_candidate.seller_id::text, 0));
    select coalesce(sum(amount_cents), 0)::int, max(created_at) into v_balance, v_latest
      from public.seller_carry_entries where seller_id = v_candidate.seller_id;
    continue when v_balance <= 0 or v_latest > now() - v_quiet;
    continue when exists (
      select 1 from public.seller_carry_payouts
       where seller_id = v_candidate.seller_id and status in ('pending', 'processing', 'failed'));

    insert into public.seller_carry_payouts (seller_id, amount_cents)
    values (v_candidate.seller_id, v_balance)
    returning id into v_payout;
    perform public.record_seller_carry(
      v_candidate.seller_id, 'paid_out', -v_balance, null, null, 'paid-out:' || v_payout::text);
    v_opened := v_opened + 1;
  end loop;
  return v_opened;
end;
$$;

create or replace function public.claim_seller_carry_payouts(
  p_worker text,
  p_batch int,
  p_lease_seconds int,
  p_max_attempts int
) returns setof public.seller_carry_payouts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_worker is null or length(p_worker) = 0 or coalesce(p_lease_seconds, 0) <= 0 then
    raise exception 'Invalid carry payout claim';
  end if;
  return query
  with due as (
    select p.id
      from public.seller_carry_payouts p
     where (p.status in ('pending', 'failed')
            and p.attempts < p_max_attempts
            and (p.next_attempt_at is null or p.next_attempt_at <= now()))
        or (p.status = 'processing' and p.lease_expires_at <= now())
     order by p.created_at
     limit greatest(1, least(coalesce(p_batch, 1), 50))
     for update skip locked
  )
  update public.seller_carry_payouts p
     set status = 'processing',
         locked_by = p_worker,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
    from due
   where p.id = due.id
  returning p.*;
end;
$$;

-- Freezes where the money goes and records that Stripe may now be called.
-- Returns the frozen destination; null = lease lost.
create or replace function public.prepare_seller_carry_payout(
  p_id uuid,
  p_worker text,
  p_destination text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payout public.seller_carry_payouts;
begin
  if p_destination is null or length(p_destination) = 0 then
    raise exception 'Invalid carry payout destination';
  end if;
  select * into v_payout from public.seller_carry_payouts where id = p_id for update;
  if not found
     or v_payout.status <> 'processing'
     or v_payout.locked_by is distinct from p_worker
     or v_payout.lease_expires_at is null
     or v_payout.lease_expires_at <= now() then
    return null;
  end if;
  update public.seller_carry_payouts
     set destination = coalesce(destination, p_destination),
         provider_call_may_have_occurred = true,
         updated_at = now()
   where id = p_id
  returning destination into v_payout.destination;
  return v_payout.destination;
end;
$$;

create or replace function public.complete_seller_carry_payout(
  p_id uuid,
  p_worker text,
  p_transfer_reference text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payout public.seller_carry_payouts;
begin
  if p_transfer_reference is null or length(p_transfer_reference) = 0 then
    raise exception 'Invalid transfer reference';
  end if;
  select * into v_payout from public.seller_carry_payouts where id = p_id for update;
  if not found then return 'lost'; end if;
  if v_payout.status = 'paid' and v_payout.transfer_reference = p_transfer_reference then
    return 'completed';
  end if;
  if v_payout.status <> 'processing'
     or v_payout.locked_by is distinct from p_worker
     or v_payout.lease_expires_at is null
     or v_payout.lease_expires_at <= now()
     or not v_payout.provider_call_may_have_occurred then
    return 'lost';
  end if;
  update public.seller_carry_payouts
     set status = 'paid',
         transfer_reference = p_transfer_reference,
         paid_at = now(),
         last_error = null,
         next_attempt_at = null,
         locked_by = null,
         lease_expires_at = null,
         updated_at = now()
   where id = p_id;
  return 'completed';
end;
$$;

-- Gives the claim up: back to waiting, failed with a retry time, or — only
-- while Stripe has certainly not been called — cancelled, which puts the
-- credit back on the seller's balance.
create or replace function public.release_seller_carry_payout(
  p_id uuid,
  p_worker text,
  p_status text,
  p_last_error text,
  p_attempts int,
  p_next_attempt_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payout public.seller_carry_payouts;
begin
  if p_status is null or p_status not in ('pending', 'failed', 'cancelled') then
    raise exception 'Invalid carry payout release status';
  end if;
  select * into v_payout from public.seller_carry_payouts where id = p_id for update;
  if not found
     or v_payout.status <> 'processing'
     or v_payout.locked_by is distinct from p_worker
     or v_payout.lease_expires_at is null
     or v_payout.lease_expires_at <= now() then
    return false;
  end if;
  if p_status = 'cancelled' then
    if v_payout.provider_call_may_have_occurred then
      raise exception 'A carry payout that may have reached Stripe cannot be cancelled';
    end if;
    perform public.record_seller_carry(
      v_payout.seller_id, 'paid_out_reversed', v_payout.amount_cents, null, null,
      'paid-out-reversed:' || v_payout.id::text);
  end if;
  update public.seller_carry_payouts
     set status = p_status,
         last_error = left(p_last_error, 500),
         attempts = coalesce(p_attempts, attempts),
         next_attempt_at = case when p_status = 'cancelled' then null else p_next_attempt_at end,
         locked_by = null,
         lease_expires_at = null,
         updated_at = now()
   where id = p_id;
  return true;
end;
$$;

revoke all on function public.open_seller_carry_payouts(int, int) from public, anon, authenticated;
revoke all on function public.claim_seller_carry_payouts(text, int, int, int) from public, anon, authenticated;
revoke all on function public.prepare_seller_carry_payout(uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_seller_carry_payout(uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_seller_carry_payout(uuid, text, text, text, int, timestamptz) from public, anon, authenticated;
grant execute on function public.open_seller_carry_payouts(int, int) to service_role;
grant execute on function public.claim_seller_carry_payouts(text, int, int, int) to service_role;
grant execute on function public.prepare_seller_carry_payout(uuid, text, text) to service_role;
grant execute on function public.complete_seller_carry_payout(uuid, text, text) to service_role;
grant execute on function public.release_seller_carry_payout(uuid, text, text, text, int, timestamptz) to service_role;

notify pgrst, 'reload schema';

commit;
