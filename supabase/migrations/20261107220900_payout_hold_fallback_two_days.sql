-- 20261107220900 — the payout hold's fallbacks become 2 days (R-hold).
--
-- Neil ruled on 4 October 2026 that sellers are paid 2 days after delivery
-- (20261009100000 set the settings row to fixed, 2 days). Two fallbacks still
-- said 7: the column default of settlement_settings.payout_hold_days, and the
-- coalesce in payout_available_at() for a missing settings row. On 7 November
-- 2026 he ruled: "You can change it to 2 days to align with my rule", so both
-- become 2, matching the configured hold. The app's DEFAULT_PAYOUT_HOLD
-- (src/lib/payments/payout-hold.ts) changes in the same PR.
--
-- What doesn't change: the deployed row (already fixed, 2 days), the
-- 'fixed' mode fallback, claim_window, the early release on a plausible
-- receipt, and every payout date already set (they are never moved).
-- payout_available_at() is restated from 20261006100000 with only the
-- coalesce's 7 changed to 2. Idempotent.

begin;

alter table public.settlement_settings alter column payout_hold_days set default 2;

-- Latest: 20261006100000. Changed: a missing settings row means 2 days, not 7.
-- When a delivered order's payout becomes available. Reads the setting at
-- the moment of delivery; a missing row means the 2-day default, so a
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
    select coalesce((select s.payout_hold_days from public.settlement_settings s where s.id), 2) as days,
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

comment on column public.settlement_settings.payout_hold_days is
  'Days from delivery until a payout is available (0–30). Owner setting; 2 since 20261009100000, and the default and missing-row fallback since 20261107220900.';

commit;
