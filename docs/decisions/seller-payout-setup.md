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
