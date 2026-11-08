# Decision: when a seller's payout is released

**Status: decided 4 October 2026 (Neil), revised the same day.** Sellers are
paid soon after delivery, not when the claim windows close. Set by migration
`20261009100000_payout_release_risk_controls.sql`, which replaces the
`claim_window` decision of `20261006100200` before it was applied anywhere.
Payout dates already set don't move.

Migrations `20261006100000_payout_hold_setting.sql` (the setting) and
`20261009100000` (the release rule and risk controls); guards
`supabase/tests/payout_hold_setting_guard.sql` and
`supabase/tests/payout_release_guard.sql`.

## Why it changed

Holding every payout until the 30-day problem window and the shop's return
window had closed meant a seller whose buyer never pressed "received" on an
untracked parcel waited about 51 days after dispatch. No large marketplace
works like that. eBay pays established sellers when the buyer pays and holds
new sellers only until 24 hours after a tracked delivery (31 days after
payment untracked). Vinted completes an order 2 days after delivery when the
buyer says nothing. Both keep the buyer's protection running after the
seller is paid and take money back from the seller when a claim succeeds.

## The rule

| How the order was delivered | Payout released |
|---|---|
| Buyer presses "received", and the parcel plausibly arrived (a carrier delivery scan on a parcel DRVN tracks, or dispatched at least `receipt_release_after_days`, 3, ago) | At once (the transfer job runs every 10 minutes) |
| Buyer presses "received" sooner than that | 2 days after the receipt |
| Carrier delivery scan, or a collection handover | 2 days after delivery (`payout_hold_days`) |
| Untracked parcel auto-confirmed 21 days after dispatch (`docs/decisions/untracked-auto-confirm.md`) | At the auto-confirm |
| A problem or dispute is open | Waits for the outcome |

The buyer keeps 30 days from delivery to report a problem whatever has been
paid. A refund after the payout reverses the Stripe transfer; if the
seller's Stripe balance can't cover it, Stripe tries the seller's payout bank
account (`debit_negative_balances`); only then does DRVN carry the loss.

The receipt check exists because "received" seconds after purchase is the
shape of stolen-card fraud: someone buys from their own seller account,
confirms at once and takes the money before the chargeback arrives.

`payout_release_at()` computes the release; `claim_window` mode still exists
and ignores every early release, so switching back is one update.

**Fallbacks (Neil, 7 November 2026, R-hold):** "You can change it to 2 days
to align with my rule". A missing settings row, a new row, and the app's
`DEFAULT_PAYOUT_HOLD` all mean a fixed 2 days, the same as the configured
hold (`20261107220900`; before it they said 7).

## The risk controls that come with it

All in `public.settlement_settings`; null switches a control off.

- **`debit_negative_balances`** on every seller's Stripe account. Set at
  account creation (`src/lib/payments/connect.ts`). Express accounts already
  default to it; `scripts/owner/stripe-negative-balances.mjs` finds and fixes
  any that don't (on 4 October all three test-mode accounts were on).
- **Receipt plausibility**: `receipt_release_after_days` (3), above.
- **Card verification** at `card_verification_from_cents` ($500): the
  PaymentIntent asks the card's bank to verify the buyer (3D Secure,
  `src/lib/payments/stripe.ts`). A verified payment generally moves a
  stolen-card chargeback to the issuer. Below it, Stripe asks only when the
  bank or Radar requires. To also verify payments Radar scores as risky
  whatever the amount, add a Radar rule in the Stripe Dashboard (Radar →
  Rules): *Request 3D Secure if `:risk_level: = 'elevated'`*.
- **No amount limit on dispatch** (Neil, 7 November 2026, N110: "similar to
  eBay", no limits on $1,000+ orders). The October rule that refused an
  untracked dispatch at `tracking_required_from_cents` ($1,000) is gone
  (`20261107200100`); the column stays, null and unused. Instead, a
  seller-entered tracking number is registered with the EasyPost carrier
  tracker whenever an EasyPost key is configured, DRVN Shipping (labels) on
  or off: off the request path, after the seller check, retried through the
  `tracker_registration` queue (`src/lib/shipping/tracker-registration.ts`).
  With no key, dispatch works exactly the same and simply isn't tracked.
  Payouts keep the release rules above; there is no high-value hold.

Not built, by decision: a trial period for new sellers, and recovering claim
losses from a seller's future sales beyond what already exists for label
costs (`20261005110100`). Revisit if losses appear.

## How to change it

In the Supabase SQL editor:

```sql
-- Release days after a scan or handover (0–30):
update public.settlement_settings set payout_hold_days = 3 where id;

-- Days in transit before "received" releases at once (0–30):
update public.settlement_settings set receipt_release_after_days = 2 where id;

-- Card verification threshold in cents, or null to switch it off
-- (tracking_required_from_cents is unused since 20261107200100):
update public.settlement_settings
   set card_verification_from_cents = 50000
 where id;

-- Back to holding until the claim windows close:
update public.settlement_settings set payout_hold_mode = 'claim_window' where id;

select * from public.settlement_settings;
```

The terms (§1, §6, §7) and the payouts tile read the same row; the terms
pick a change up within 5 minutes. Have counsel read the resulting sentences
(`docs/legal-review-checklist.md`, "Holding funds").
