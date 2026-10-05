-- 20261006100000 — the payout clearing hold becomes one owner-set value.
--
-- Until now "7 days after delivery" was written into every path that starts a
-- seller's payout clock — the delivery trigger (20261004140000), pickup_redeem
-- (20261004120000) and mark_order_received's p_hold_days default
-- (20260905223236) — and separately into the app (ledger.ts
-- CLEARING_HOLD_DAYS, the payouts tile, the terms). How long DRVN holds a
-- seller's money is a business decision (docs/decisions/payout-hold.md), so
-- it now lives in one row the owner edits, and both the SQL and the app read
-- that row.
--
-- settlement_settings is a single-row table. Its defaults keep today's
-- behaviour exactly: a fixed 7-day hold. The owner can set
--   payout_hold_days  0–30, counted from delivery; and
--   payout_hold_mode  'fixed'        — delivery + payout_hold_days, or
--                     'claim_window' — the later of that, the 30-day window
--                                      to report a problem, and the shop's
--                                      own return window on the order.
-- Anyone may read the row: the terms and the payouts page quote it, and it is
-- the same rule the terms already publish. Nobody but the owner (SQL editor /
-- service role) can change it.
--
-- payout_available_at() is the one place the rule is computed. The three
-- clock-starting paths are restated from their latest definitions with only
-- the '7 days' changed to a call to it. A payout date, once set, is never
-- moved: changing the setting affects orders delivered after the change.
--
-- Idempotent. No signature changes except mark_order_received's p_hold_days
-- default (7 → null, meaning "use the setting"); the app stops passing it.

begin;

create table if not exists public.settlement_settings (
  id boolean primary key default true,
  payout_hold_days integer not null default 7,
  payout_hold_mode text not null default 'fixed',
  updated_at timestamptz not null default now(),
  constraint settlement_settings_single_row check (id),
  constraint settlement_settings_hold_days check (payout_hold_days between 0 and 30),
  constraint settlement_settings_hold_mode check (payout_hold_mode in ('fixed', 'claim_window'))
);

insert into public.settlement_settings (id) values (true) on conflict (id) do nothing;

alter table public.settlement_settings enable row level security;
revoke all on public.settlement_settings from public, anon, authenticated;
grant select on public.settlement_settings to anon, authenticated;

drop policy if exists "settlement settings are public" on public.settlement_settings;
create policy "settlement settings are public" on public.settlement_settings
  for select to anon, authenticated using (true);

drop trigger if exists settlement_settings_touch_updated_at on public.settlement_settings;
create trigger settlement_settings_touch_updated_at
  before update on public.settlement_settings
  for each row execute function public.touch_updated_at();

-- When a delivered order's payout becomes available. Reads the setting at
-- the moment of delivery; a missing row means the 7-day default, so a
-- deleted settings row can never strand a payout. The 30 is the buyer's
-- window to report a problem (DISPUTE_WINDOW_DAYS in
-- src/features/commerce/disputes.ts; payout-hold.test.ts keeps them equal).
-- A malformed return-policy snapshot is ignored rather than allowed to fail
-- the delivery that called this.
create or replace function public.payout_available_at(p_order uuid, p_delivered_at timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_delivered_at + make_interval(days => case
    when policy.mode = 'claim_window' then greatest(policy.days, 30, coalesce(shop.window_days, 0))
    else policy.days
  end)
  from (
    select coalesce((select s.payout_hold_days from public.settlement_settings s where s.id), 7) as days,
           coalesce((select s.payout_hold_mode from public.settlement_settings s where s.id), 'fixed') as mode
  ) policy
  left join lateral (
    select max((oi.commercial_snapshot #>> '{commercial,return_policy,window_days}')::integer) as window_days
      from public.order_items oi
     where oi.order_id = p_order
       and oi.commercial_snapshot #>> '{commercial,return_policy,returns_accepted}' = 'true'
       and oi.commercial_snapshot #>> '{commercial,return_policy,window_days}' ~ '^[0-9]{1,3}$'
  ) shop on true
  where p_delivered_at is not null;
$$;

revoke all on function public.payout_available_at(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.payout_available_at(uuid, timestamptz) to service_role;

-- Latest: 20261004140000. Changed: the available_at expression.
create or replace function public.start_payout_clock_on_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.delivered_at is not null then
    update public.transfer_intents
       set available_at = coalesce(available_at, public.payout_available_at(new.id, new.delivered_at)),
           updated_at = now()
     where order_id = new.id
       and status = 'holding'
       and available_at is null;
  end if;
  return new;
end;
$$;

-- Latest: 20261004120000. Changed: the available_at expression and the
-- comment above it.
create or replace function public.pickup_redeem(
  p_order_id uuid,
  p_seller_id uuid,
  p_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_pass record;
begin
  select o.id, o.seller_id, o.status, o.is_collection
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found or v_order.seller_id is distinct from p_seller_id then
    return jsonb_build_object('ok', false, 'reason', 'not_your_order');
  end if;
  if not v_order.is_collection then
    return jsonb_build_object('ok', false, 'reason', 'not_pickup');
  end if;
  if v_order.status <> 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'not_redeemable');
  end if;

  select * into v_pass
    from public.pickup_confirmations
   where order_id = p_order_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_pass');
  end if;
  if v_pass.redeemed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  end if;
  if v_pass.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_pass.attempts >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  if v_pass.token_hash <> p_hash and v_pass.code_hash <> p_hash then
    update public.pickup_confirmations
       set attempts = attempts + 1
     where order_id = p_order_id;
    return jsonb_build_object('ok', false, 'reason', 'mismatch');
  end if;

  -- Handoff proven: single-use stamp + the same delivered/clearing entry a
  -- shipped order gets from the buyer''s confirm.
  update public.pickup_confirmations
     set redeemed_at = now(), redeemed_by = p_seller_id
   where order_id = p_order_id
     and redeemed_at is null;

  update public.orders
     set status = 'delivered',
         delivered_at = now(),
         completed_at = now()
   where id = p_order_id
     and status = 'paid';

  -- The handoff starts the payout clock exactly as a buyer's receipt does
  -- for a shipped order (confirm_order_receipt): available when the owner's
  -- clearing hold (settlement_settings, 20261006100000) has passed since
  -- delivery. Without this the intent stayed 'holding' with no
  -- available_at, and mark_due_transfer_intents never released it.
  update public.transfer_intents
     set available_at = coalesce(available_at, public.payout_available_at(p_order_id, now())),
         updated_at = now()
   where order_id = p_order_id
     and status = 'holding';

  return jsonb_build_object('ok', true);
end;
$$;

-- Latest: 20260905223236. Changed: p_hold_days defaults to null ("use the
-- setting"); an explicit value is still honoured, within the same 0–30
-- bounds, so an app deployed before this migration behaves as before.
create or replace function public.mark_order_received(
  p_order uuid,
  p_actor uuid,
  p_hold_days integer default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.orders;
  intent public.transfer_intents;
  stamped_at timestamptz:=now();
  applied boolean:=false;
  stub_settlement boolean:=false;
begin
  if p_order is null or p_actor is null or p_hold_days<0 or p_hold_days>30 then
    raise exception 'Invalid receipt transition';
  end if;
  select * into strict o from public.orders where id=p_order for update;
  if o.buyer_id is distinct from p_actor then raise exception 'Buyer authorization required' using errcode='42501'; end if;
  if o.is_collection then raise exception 'Collection orders use the pickup handoff'; end if;
  if o.status not in ('shipped','delivered','completed') then
    return jsonb_build_object('ok',false,'applied',false,'status',o.status,'reason','Only a dispatched order can be received.');
  end if;

  select * into intent from public.transfer_intents where order_id=o.id for update;
  if not found then
    select exists(
      select 1 from public.payments p where p.order_id=o.id
      and p.provider='stub' and p.status='succeeded' and p.provider_reference is not null
      and p.amount_cents=o.total_cents and lower(p.currency)=lower(o.currency)
    ) into stub_settlement;
    if not stub_settlement then raise exception 'Seller transfer obligation is missing'; end if;
  end if;

  if o.status='shipped' then
    update public.orders set status='delivered',delivered_at=stamped_at,completed_at=stamped_at where id=o.id;
    o.status:='delivered';
    o.delivered_at:=stamped_at;
    applied:=true;
    update public.shipments set status='delivered',delivered_at=coalesce(delivered_at,stamped_at)
    where order_id=o.id and direction='outbound' and status in ('label_purchased','in_transit','out_for_delivery');
  elsif o.delivered_at is null then
    raise exception 'Delivered order is missing its receipt timestamp';
  end if;

  if not stub_settlement then
    update public.transfer_intents set
      available_at=coalesce(available_at,case
        when p_hold_days is null then public.payout_available_at(o.id,o.delivered_at)
        else o.delivered_at+make_interval(days=>p_hold_days)
      end),
      updated_at=now()
    where order_id=o.id and status='holding';
  end if;

  return jsonb_build_object(
    'ok',true,'applied',applied,'replayed',not applied,'status',o.status,
    'available_at',(select available_at from public.transfer_intents where order_id=o.id)
  );
end $$;

do $$
begin
  if (select count(*) from public.settlement_settings) <> 1 then
    raise exception 'SELF-CHECK FAILED: settlement_settings must hold exactly one row';
  end if;
  if public.payout_available_at(null, timestamptz '2026-01-01 00:00+00') is null then
    raise exception 'SELF-CHECK FAILED: payout_available_at returned null for a delivered order';
  end if;
  if has_function_privilege('anon', 'public.payout_available_at(uuid,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.payout_available_at(uuid,timestamptz)', 'execute') then
    raise exception 'SELF-CHECK FAILED: payout_available_at is client-callable';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
