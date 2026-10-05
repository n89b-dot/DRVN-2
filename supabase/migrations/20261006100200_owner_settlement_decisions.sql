-- 20261006100200 — the owner's settlement decisions (Neil, 4 October 2026).
--
-- docs/decisions/payout-hold.md and docs/decisions/untracked-auto-confirm.md
-- built both rules behind settlement_settings with neutral defaults. The
-- decisions taken:
--   * payout hold: claim_window — a seller is paid once the later of the
--     7-day clearing hold, the 30-day problem window and the order's shop
--     return window has passed, so a refund after delivery rarely needs a
--     clawback from a seller already paid;
--   * auto-confirm: 21 days — an untracked shipment the buyer never confirms
--     is confirmed 21 days after dispatch, after one in-app warning
--     (auto_confirm_notice_days, 3).
-- Payout dates already set are never moved by a settings change; only
-- deliveries from now on use the new rule.
-- Idempotent.

begin;

update public.settlement_settings
   set payout_hold_mode = 'claim_window',
       payout_hold_days = 7,
       auto_confirm_after_days = 21
 where id;

commit;
