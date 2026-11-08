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

## Not yet ruled: an order dispatched before day 14

If the seller dispatched (or the buyer has received) the part by day 14 and
payouts are still off, nothing is refunded: the buyer has the part, and the
payout keeps waiting until Stripe enables payouts. The seller's listings
still come down. This was proposed to Neil on 8 November and he didn't
object, but it isn't a ruling yet. Until he rules, no dispatched order is
refunded by this rule.

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
