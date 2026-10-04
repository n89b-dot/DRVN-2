# Release readiness, round three: implementation record (3–4 October 2026)

This round answers my own whole-repo readiness review of 3 October (the
published report). It covers every P0, every code-fixable P1, and a few P2s.
It is not a release approval: hosting, an email provider, branch protection,
counsel review and the 15-gate candidate packet still need their owners.

Starting point: `main` at `5ee47ed` (PR #4 merged; its tree equals the
CI-tested merge `8ecbf94`).

## Findings closed in code

| Finding | What changed | Evidence |
|---|---|---|
| P0 — anyone could write notifications to any member | `notify()` and four cron/worker functions (`invoke_transfer_worker`, `mark_due_transfer_intents`, `escalate_stale_disputes`, `prune_rate_limits`) were SECURITY DEFINER, unchecked and executable by anon. Revoked from every client role (`20261004100000`). A new guard fails if any non-trigger definer function a guest can execute is missing from a reviewed list. | `definer_exposure_guard.sql` (fails on the old schema with exactly those five; passes after). Shared dev: a guest API call to `notify` now returns 401. |
| P0 — a return's refund could pay out twice | Every refund now belongs to a business request. `begin_request_refund_operation` adopts a live (not failed) operation with the same key; a unique partial index backs it (`20261004110000`). Returns use `return:<id>`. Uncertain refunds return `pending` instead of plain failure. | `refund_request_key_guard.sql` (9 cases, including a $200 order with a $100 pending return retried); `refund-request-key.test.ts`. |
| P0 — accepting a refund offer could pay out twice | The offer is claimed and restored with its original timestamp, so its key `offer:<order>:<offered_at>` is stable and re-accepting adopts the same refund. Claim and restore errors are checked. A pending refund tells the buyer not to accept again. | Same guard; `dispute-actions.ts`. |
| P1 — "refund issued" posted when nothing changed | `confirmReturnReceived` checks every write and re-reads. "Refund issued" only follows a refund that went through; pending and retrying cases say so. | `return-actions.ts`. |
| P1 — fee on shipping misstated | Terms, Settings, cart and the order breakdown now say the fee is 10% of the item price plus shipping. | Copy changes; no other contradicting copy found. |
| P1 — privacy and terms out of date | Rewritten from the code and dated 3 October 2026. Retention periods are marked as still being set. | `docs/legal-review-checklist.md` lists counsel's decisions. |
| P1 — tiny or huge charges stranded listings | A charge must be 50¢–$999,999.99: baskets (`purchase_begin`), accepted offers, publishing and live price changes (trigger). A Stripe 400 that created no PaymentIntent releases its orders through `record_payment_request_rejection` (`20261004130000`). | `charge_bounds_guard.sql`; `stripe-create-payment.test.ts`; checkout tests. |
| P1 — sellers could set any currency | `listings` and `orders` accept only `USD` (lowercase `usd` rows normalised first, then validated). | `charge_bounds_guard.sql`; dev constraints validated. |
| P1 — SLA auto-refund looped on chargebacks | The sweep skips orders with a `stripe_dispute_id`. | `dispute-sla.ts`. |
| P1 — duplicate Stripe customers on a failed read | `getStripeCustomerId` and the Connect lookup throw on read errors; pointer writes are checked and re-read. | `stripe-pointers.test.ts` (10). |
| P1 — admin console showed failed reads as zero | Overview, payments ops, case queue and order detail throw into a new admin error boundary; nav counts show "?". 7-day money totals come from `admin_order_money_window` (`20261004131000`), not 1,000-row-capped sums. | `admin_money_window_guard.sql` (1,200 orders); `queries-reads.test.ts`. |
| P1 — suspend/unsuspend ignored errors | Both run through `execute_admin_command` (one transaction). The unused TypeScript path now checks every error too, and messages use real counts. | `audit-transactional.test.ts`. |
| P1 — main's CI flaked on the messaging test | Smooth scrolling through the whole conversation left a message arriving mid-scroll unfollowed. Jumps to the latest are now instant. | Run 37157644807 trace. |
| P1 — collected orders were never paid out | `pickup_redeem` now starts the payout clock; stranded intents backfilled (`20261004120000`). | `return_guard.sql` (extended). |
| P1 — orders the buyer never confirmed were never paid out | A trigger starts the clock whenever an order becomes delivered, including by carrier scan, at delivery + 7 days, as the receipt did (`20261004140000`). Disputes still hold the payout. Untracked shipments with no delivery scan still wait for the buyer (owner decision). | `payout_clock_guard.sql` (fails on the old schema). |
| P2 — payout shown as total − fee in two places | The sales list uses `sellerProceeds`; the admin order page shows the amount actually transferred. | Typecheck; existing tests. |
| P2 — Connect events unverifiable | The webhook accepts an event signed by the platform or the Connect endpoint secret (`STRIPE_CONNECT_WEBHOOK_SECRET`, required in live mode). `account.updated` for an account that isn't DRVN's is acknowledged instead of retried for three days. | `route.test.ts` (3 new cases); `env.test.ts`. |
| P2 — any guest could read a car's VIN | Column privileges: every `cars` column but `vin` is granted; the owner reads it through `my_car_vin`; `edit_car_gallery` names its columns (`20261004160000`). The two `select("*")` reads use `CAR_COLUMNS`. | `car_vin_privacy_guard.sql` (fails on the old schema). |
| P2 — runbook, env example, monitor, import sweep, legal links | Runbook and `.env.example` match `env.ts`, Stripe events (both endpoints), and the nine cron jobs. The monitor's actions are pinned. The import-data sweep is scheduled and monitored (`20261004150000`). Settings → Privacy links the policies. `docs/staging-setup.md` written. | `listing_import_sweep_guard.sql`; `check-worker-health.test.mjs`. |

## Verification on this branch

- SQL: a fresh `supabase/postgres:15.14.1.158` with `ci_shim.sql` and every migration in order; all 62 `*_guard.sql` pass. Every new migration re-applies cleanly.
- Replaced functions were diffed against a database built from `main`: the only removals are lines replaced by their extended versions, and some code comments.
- Generated types: byte-identical to a regeneration from that database.
- `npx tsc --noEmit`: clean. ESLint on every changed file: clean. `npm test`: 132 files, 873 tests, all pass.
- Browser: the full suite on the isolated local stack (result recorded in the PR).

## Still open

- **Owner:** hosting and email provider, Stripe live endpoints (both secrets), GitHub Pro and branch protection, counsel review and retention periods, auto-confirm rule for untracked shipments, paying sellers before return and dispute windows close.
- **Code (round four):** login and reset throttling, the shared guest rate-limit bucket, message-photo GPS data, guest email attach, forms that crash on a lost response, beta-outage copy, post metadata, label-cost collection, refund queue stall, offer-collection shipping, slow pages, the Apple Pay header, and the P3 clean-up. Also: unsuspend doesn't check for a pending account deletion; `payWithSavedCard` now surfaces a customer-lookup failure as an error page (PR #6 owns that file).
