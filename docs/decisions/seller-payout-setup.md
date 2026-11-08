# Decision: when a seller must have payouts set up

**Status: decided 8 November 2026 (Neil): "go with the eBay approach, 14 days".**
Replaces the rule `20261107210000` (N244, OS-W16) put in the database, where
with real payments a seller could neither publish nor be bought from until
Stripe reported their payouts enabled.

## Why it changed

eBay asks a new seller for identity and bank details while they make their
first listing, but doesn't block a sale while those details are checked: the
buyer pays, and the seller's payout is held until verification clears. A
seller who never finishes is restricted and their listings end. DRVN's rule
was stricter: a new seller couldn't list until Stripe had finished verifying
them, which can take days.

## The rule

| Step | Needs |
|---|---|
| Put a listing live | Stripe setup **started**: the seller has submitted their details to Stripe, even if Stripe is still verifying them |
| A buyer pays | The same: setup started. Payouts don't need to be enabled yet |
| The payout is released | Stripe reports payouts enabled. Until then it waits (`blocked_unpayable`), and is released as soon as they are |
| 14 days after the sale, payouts still not enabled | An order not yet dispatched is cancelled and the buyer refunded in full. The seller's live listings come down until their payouts are enabled |

With the stub payment provider there is no money to move, so there is no gate
(`job_config.payments_mode = 'stub'`, as before).

## How it is built (20261108100000)

- **Setup started** is Stripe's `account.details_submitted`, stored as
  `profiles.payout_details_submitted` by the same Connect sync that stores
  `payouts_enabled` (`src/lib/payments/connect.ts`, `applyAccountUpdate` in
  `src/lib/payments/settlement.ts`). Members can't write it.
- **One answer for every gate.** `private.seller_can_take_payment` is what
  publishing, reserving a part, cart checkout's skip and a new payment
  request all ask: payouts enabled, or a connected account with details
  submitted and no day-14 restriction. The app's `sellerCanPublish` asks the
  same question of the same columns (`payoutSetupState` in
  `src/lib/payments/payout-readiness.ts`).
- **Day 14** runs in the money worker (`payoutDeadlines` family, every 10
  minutes). The clock is the sale: the capture that writes the order's
  payout (`transfer_intents.created_at`), while that payout hasn't been made
  or cancelled. The database restricts the seller
  (`profiles.payout_restricted_at`), pauses their live listings and records
  which ones, and claims each order still `paid` with no `shipped_at`. A
  claimed order can't be marked dispatched (LS002). The worker refunds it in
  full through the one refund path with request key `payout_deadline:<order>`,
  so a retry adopts the same refund and a refunded order has nothing left to
  refund, then puts the part back as a paused listing
  (`src/lib/payments/payout-deadline.ts`).
- **Payouts enabled** clears the restriction and puts back on sale exactly
  the listings the rule paused (not ones the seller paused themselves). The
  parked payouts are released as before.

## Set aside: an order dispatched before day 14

If the seller dispatched (or the buyer has received) the part by day 14 and
payouts are still off, nothing is refunded: the buyer has the part, and the
payout keeps waiting until Stripe enables payouts. The seller's listings
still come down. Neil, 8 November: there are no orders to dispatch yet, so
the case doesn't arise and needs no ruling now. It stays as built (no
refund); revisit it if live orders make it real.

## What eBay does

From eBay's own pages: a seller confirms identity and links a payout bank
account at registration, verified by bank login, microdeposits or a
statement ([Registering as a seller](https://www.ebay.com/help/selling/getting-paid/submitting-updating-information-managed-payments?id=4792));
payouts are made "once you have completed the Linked Financial Account
verification process and passed security and compliance checks"
([Payments Terms of Use](https://pages.ebay.com/payment/2.0/terms.html));
payouts are held for registration discrepancies, and a new seller's funds
are typically released 2–7 days after delivery
([Payments on hold](https://www.ebay.com/help/selling/getting-paid/payments-holds?id=4816),
[Getting paid](https://www.ebay.com/help/selling/getting-paid/getting-paid-items-sold-?id=4814));
sellers who don't complete required details by a deadline are restricted
and their live listings end
([Getting paid has changed](https://pages.ebay.com/C2Cmanagedpayments/index_app.html)).
No official eBay page confirms that a listing can go live and sell before
verification finishes; community posts say the first listing starts
registration. Neil chose this approach knowing that.

## How it is held (20261108110000)

A follow-up to the review of #123. The rule above is unchanged; these fix
how the database and the worker hold it.

- **A claimed order can't be handed over by any path.** Dispatch
  (`mark_order_dispatched`) and both collection steps (`pickup_mint_pass`,
  `pickup_redeem`) refuse a claimed order whether or not the buyer has opened
  a case, and the orders trigger refuses any write that records a handoff
  (status, `pre_dispute_status`, `shipped_at`, `delivered_at`) while the
  claim is open. Before, a not-received case kept the order `disputed` and
  dispatch moved only `pre_dispute_status`, so the fence never ran.
- **Retries rotate.** Each claim has its own schedule (`attempts`,
  `next_attempt_at`). A pass hands the worker only claims that are due and
  pushes each back as it does (5 minutes, doubling, at most 6 hours), so a
  few refunds that keep failing can't starve later ones.
- **The refund is always the whole order.** `begin_payout_deadline_refund`
  reserves it under the order lock: it adopts the deadline's own refund while
  that is in flight, waits (reserving nothing) while any other refund of the
  order is in flight, and otherwise reserves everything not yet refunded. A
  deadline refund that completed short is topped up under the next key of the
  request (`payout_deadline:<order>:1`, …), never adopted again.
- **Payouts enabled always wins.** Settling and the sweep lock the seller's
  profile before the listings, the order a payouts update takes, so a
  settlement can't pause a part just after payouts were enabled. Every sync
  that reports payouts enabled restores what the rule still holds.
- **Only a complete listing goes back on sale.** At payouts enabled and at
  settlement, a part goes live again only if it meets what publishing needs
  (payouts, not suspended, at least one photo). One that doesn't, say its
  photos were removed while it was paused, stays paused for the seller to
  finish and publish.
