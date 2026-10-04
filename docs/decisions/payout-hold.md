# Decision: how long to hold a seller's payout after delivery

**Status: built. Default unchanged: 7 days. Owner picks the value.**
Migration `20261006100000_payout_hold_setting.sql`; guard
`supabase/tests/payout_hold_setting_guard.sql`.

## The problem

A seller is paid **7 days after delivery**. The buyer can report a problem for
**30 days** after delivery (`DISPUTE_WINDOW_DAYS`). Shops that offer returns
promise **14, 30 or 60 days**. So most problems that can still arrive come in
*after* the seller has been paid.

When that happens, DRVN refunds the buyer and takes the seller's share back.
It first reverses the Stripe transfer. If the seller's Stripe balance has
already gone to their bank, the remainder is carried forward against their
next sale (`20261005110100`). A seller with no next sale leaves DRVN short,
because on Express/Custom Connect accounts the platform is liable for negative
balances. Card chargebacks can arrive for months whatever the hold, so the
hold reduces this risk but can't remove it.

## What is built

The hold is now **one value in one row** (`public.settlement_settings`). Every
path that starts a payout clock reads it: a carrier scan, the buyer's
"received", a collection handover, and the untracked auto-confirm. The seller's
ledger dates, the payouts tile ("Clears … after delivery") and the terms (§6)
read the same row. There are two modes:

- `fixed`: delivery + `payout_hold_days` (0–30).
- `claim_window`: whichever is latest of the hold, the 30-day problem window,
  and the order's own shop return window (frozen on the order at purchase).

The date is fixed when the order is delivered. Changing the setting affects
orders delivered afterwards, and never moves a payout already scheduled. A
missing row falls back to 7 days, so a payout is never stranded.

## Options

| Hold | Seller waits after delivery | Clawback exposure | Notes |
|---|---|---|---|
| **7 days** (today) | 7 days | Days 8–30 of the problem window, and up to day 60 of shop returns | Fast and competitive. Relies on reversal and carry-forward |
| **14 days** | 14 days | Days 15–30, and shop returns | Catches the early "wrong part / doesn't fit" reports, which tend to come at first fitting |
| **30 days** (`fixed`, 30) | 30 days | Shop returns longer than 30 days only | Equal to the problem window |
| **Window-based** (`claim_window`) | 30 days, or 60 for a 60-day shop | None from DRVN's own windows | Nothing DRVN promises the buyer is still open when the seller is paid |

Card-issuer chargebacks are outside all four. Keep any hold well within
Stripe's limit on how long a platform may keep a charge's funds before
transferring them; check the current Connect docs for DRVN's region.

## Recommendation: window-based at launch, then review

At launch DRVN has new sellers, no reserve, and carry-forward that only works
if a seller sells again. Paying out before DRVN's own promises to the buyer
have expired means DRVN takes on the risk. With the window-based hold, refunds
for problems and returns come from money DRVN still holds.

The cost is that sellers wait about a month. That is in line with how
marketplaces treat new sellers (held funds or a reserve until there's a track
record). The payouts page states it plainly.

**Review after about three months.** If very few problems are reported after
day 14, switch to `fixed` 14. A later improvement could be a per-seller hold
(shorter for established sellers), but that is not built.

One edge to know about, whichever option you pick: a shop return opened just
before its window closes may still be in progress when the payout is released.
The payout path doesn't check for an open return (this is how it works today).
The refund then goes through reversal and carry-forward as above.

## How to change it

Apply migration `20261006100000` (it changes nothing on its own). Then, in the
Supabase SQL editor:

```sql
-- Recommended: hold until DRVN's problem and return windows have closed.
update public.settlement_settings set payout_hold_mode = 'claim_window' where id;

-- Or a fixed hold (0–30 days):
update public.settlement_settings
   set payout_hold_mode = 'fixed', payout_hold_days = 14
 where id;

-- Check:
select * from public.settlement_settings;
```

The terms page picks up the change within 5 minutes, and the payouts tile on
the next page load. Before switching, have counsel read the resulting sentence
in terms §6 (`docs/legal-review-checklist.md`, "Holding funds"). For example,
window-based mode reads: *"A sale is paid out 30 days (or once the shop's
return window closes, if later) after the buyer confirms the order arrived."*
