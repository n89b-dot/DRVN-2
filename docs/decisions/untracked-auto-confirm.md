# Decision: auto-confirm untracked shipments

**Status: decided 4 October 2026 (Neil): on, 21 days** (3-day warning), set by migration `20261006100200_owner_settlement_decisions.sql`. Caveat from the recommendation below still applies: the warning is in-app only until an email channel exists, so a guest buyer won't see it before their order auto-confirms.
Migration `20261006100100_untracked_delivery_auto_confirm.sql`; guard
`supabase/tests/delivery_auto_confirm_guard.sql`.

## The problem

A shipped order becomes *delivered* — which starts the seller's payout clock —
in one of three ways: the buyer presses "received", a carrier scan reports it
(parcels DRVN tracks through EasyPost), or a collection is handed over. A
parcel the seller posted with a tracking number DRVN doesn't follow never gets
a scan. If that buyer never presses "received", the order stays *shipped* and
**the seller is never paid**. Nothing times out today.

## What is built

An hourly database job (`drvn-delivery-auto-confirm`) that, when switched on:

1. **Warns the buyer once** when an eligible order is N − 3 days past dispatch:
   *"Has your order arrived? Confirm receipt or report a problem. If we don't
   hear from you, we'll mark it delivered in 3 days and the seller will be
   paid."* The warning fixes the confirmation date, and that date is never
   less than 3 days after the warning. So switching the rule on over a backlog
   of old orders still gives every buyer full notice.
2. **On that date, if the order is still eligible, marks it delivered**. It
   makes the same order, shipment and payout writes as the buyer's own
   "received". It adds a line to the order's tracking history ("Marked
   delivered automatically: no problem was reported within N days of
   dispatch") and tells both sides. The seller's message says no problem was
   reported, not that the buyer confirmed.

**Eligible** means all of these: still *shipped*; not a collection; never
disputed by the buyer or the card issuer; nothing refunded or being refunded;
no return ever opened; and no DRVN carrier tracking on any parcel. A tracked
parcel waits for its scan, and a parcel the carrier reported as failed or
returned is treated as a problem, not a delivery. If any of these stops being
true between the warning and the date, the order is left alone.

After an auto-confirm, the buyer keeps the normal 30 days from delivery to
report a problem. The seller's payout then follows the clearing hold
(`payout-hold.md`).

Each run is recorded as the **Auto-confirm untracked deliveries** job in
Admin → Settings → Background jobs and in `/api/health/workers`, including
while the rule is off. If an order can't be confirmed (for example, its payout
record is missing), the run is marked failed and the reason is kept on the
order's row. That order is retried every hour.

## Options

| N (days after dispatch) | Seller paid after (with the 7-day hold) | For | Against |
|---|---|---|---|
| **Off** (today) | Never, unless the buyer confirms | No risk of confirming a parcel that never came | Sellers of untracked parcels can go unpaid indefinitely; support has to chase buyers by hand |
| **14** | ~21 days | Fast for sellers | Too short for slow or international post. The buyer gets a warning while the parcel may still be in transit |
| **21** | ~28 days | Covers almost all domestic and most international untracked post, and leaves a week of slack | The seller waits three weeks for something the buyer could confirm on day 3 |
| **30** | ~37 days | Safest | A month of waiting pushes sellers toward tracked postage (which may be no bad thing) |

N can be anything from 7 to 60. The warning lead (3 days) can be 1–7.

## Recommendation: 21 days, but wire up email first

21 days is long enough that a parcel really is late, not just slow. The buyer
is still protected afterwards, because the 30-day problem window starts on the
auto-confirm date.

**One caveat to weigh before turning it on:** the warning is an in-app
notification only. DRVN has no email channel for notifications yet
(`docs/owner/email-provider.md`). A guest buyer, who has a passwordless
account they may never open, would not see it. They can still report a
problem for 30 days through their emailed order link. Even so, the honest
version of "we warned you" is an email. Either add the email first, or turn
the rule on knowing that guest buyers get no warning.

## How to turn it on

Both migrations must be applied (`20261006100000`, then `20261006100100`). The
app needs no deploy for the rule itself. In the Supabase SQL editor:

```sql
-- See first who would be warned (nothing is sent):
select o.id, o.shipped_at
  from public.orders o
 where public.delivery_auto_confirm_eligible(o.id)
   and o.shipped_at <= now() - interval '18 days';   -- N − 3

-- Turn it on (N = 21, 3 days' warning):
update public.settlement_settings
   set auto_confirm_after_days = 21, auto_confirm_notice_days = 3
 where id;

-- Watch it:
select * from public.delivery_auto_confirmations order by reminded_at desc;
select summary, status, finished_at from public.worker_runs
 where family = 'deliveryAutoConfirm' order by started_at desc limit 5;

-- Turn it off (pending confirmations stop at once; warnings already sent stay sent):
update public.settlement_settings set auto_confirm_after_days = null where id;
```

Good to know:

- Changing N affects orders not yet warned. A date already given to a buyer is
  kept.
- If you switch the rule off and later on again, orders whose date passed
  while it was off are confirmed on the next run without a second warning.
- The terms (§6) say a sale is paid "after the buyer confirms the order
  arrived". If you turn this on, ask counsel to add "or after N days without a
  reported problem" (`docs/legal-review-checklist.md`).
