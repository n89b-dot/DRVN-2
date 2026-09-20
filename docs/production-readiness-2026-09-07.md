# DRVN product readiness report — 7 September 2026

Reviewed against `main` at `d3fe36e` (PR #2 merged 2026-09-07 19:33 UTC). Supersedes the 4 September report for every area it re-examines; the 5 September completion plan and the `docs/readiness-progress` tracker remain the working checklists.

## Verdict

**Ready for an invited beta once a hosted staging environment exists. Not ready for public, unrestricted live-money launch.**

The engineering work the 4 September review demanded has landed and is verified in source, not only in documents: late-capture compensation, atomic payout-intent creation, real guest receipt delivery through a durable worker, buyer-scoped checkout idempotency, atomic admin audit, bounded monitoring, hard production environment gates, a nonce-based CSP, admin MFA, and a database-enforced invitation gate. The release pipeline now refuses to go green unless the browser and Stripe suites actually ran, and it is doing exactly that today: `main` is red on one browser case, so the current revision has no release evidence yet.

What is left is almost entirely outside the repository: a hosted staging project, GitHub branch protection, real Stripe Connect and 3DS journeys over HTTPS, external alert delivery, retention policy decisions, manual accessibility acceptance, and the pilot itself. Two in-repo items still need attention before real buyers see the site: the Terms page hardcodes a "payments are in test mode" clause, and the legal pages carry no entity, governing-law or tax terms.

## Evidence classes

Following DRVN's own habit of separating source facts from claims and inferences, every statement below is tagged:

- **Verified here** — I ran the check or read the code in this review.
- **Recorded elsewhere** — a CI run, tracker entry or evidence file written by earlier sessions; I checked that the record exists and is internally consistent, not that it is true.
- **Not verifiable locally** — requires hosted infrastructure, provider access or a human.

## Checks run in this review (verified here)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | 0 errors, 3 warnings (unused `eslint-disable` directives) |
| `npm test` | 96 files, 645 tests, all pass |
| `npm run build` (placeholder env) | Pass; 68 pages, 28 route handlers, proxy middleware |
| `npm audit` / `npm audit --omit=dev` | 0 vulnerabilities in both trees (was 4 high in dev tree on 4 Sept) |
| CI on `main` @ `d3fe36e` (run 34156058772) | **Red.** `verify` and `sql-guard` green; `e2e` failed one Chromium case (`offer-action-recovery.spec.ts` › withdraw retry after committed request: the `withdrawn` state never rendered after retry); `release-gate` failed and `stripe-integration` was skipped because it depends on `e2e`. The same case failed identically on the parallel PR run of the same tree (34156040340), so this is reproducible, not a flake |
| Last complete CI run (34012750876, branch head `22c521d`) | All six jobs green including `stripe-integration` and `release-gate` (recorded elsewhere) |
| Branch protection on `main` | Unavailable — GitHub returns 403 (private repo on Free plan) |
| Independent worker monitor workflow | Every scheduled run since 6 Sept **skipped**: `DRVN_MONITOR_ENABLED` repository variable is not set |
| Repository inventory | 104 migrations, 42 SQL guard suites, 36 Playwright spec files, 10 operations tests, 1 Stripe integration suite |

## Status of the 4 September findings (verified here in source)

| ID | Finding | Status | Where |
|---|---|---|---|
| R1 | Successful payment on cancelled order left uncompensated | **Fixed** | `settle_payment_capture` checks `applied`, opens `refund_operations` row (`purpose='late_capture'`) for cancelled/failed orders; `settleIntent` only acknowledges `settled` / `compensation_queued` |
| R2 | Payout intent insert could fail while webhook said 200 | **Fixed** | Transfer-intent insert is inside the settlement transaction with an existence assertion; `capture_reconciliation_candidates()` sweeps paid orders lacking a payout obligation |
| R3 | Guest receipt email never sent | **Fixed** | `enqueue_order_receipt` from the settlement RPC; `receipt-worker.ts` delivers a Supabase magic link with timeout, lease and retry. No third-party SMTP — Supabase Auth is the sender |
| R4 | Retries reused Stripe key with changed params; idempotency not buyer-scoped | **Fixed** | `prepare_payment_request` freezes params under a deterministic operation key; `purchase_begin` rejects mismatched buyer or basket fingerprint under advisory locks |
| R5 | CI admin guard failing; suites skipped silently | **Fixed** | 42 guards run independently; `release-gate` requires `e2e.ran` and `stripe.ran` to be true |
| R6 | Admin mutation and audit not atomic | **Fixed** | `execute_admin_command` RPC for database actions; journal-first `begin_admin_external_operation` for provider actions |
| R7 | Monitoring could block money endpoints | **Fixed** | 2 s per-send abort, `response.ok` checked, 32 in-flight cap, 1 s flush budget; intake capped at 8 KiB with fail-closed limiter |
| R8 | Worker could launch without scheduler | **Fixed in code** | `validatePaymentsEnv` hard-fails live production on missing `SENTRY_DSN`, short `CRON_SECRET`, non-HTTPS alert URL; `/api/health/workers` exists. **The external monitor is not provisioned** (see above) |
| R9 | Browser-renderer DNS rebinding | **Mitigated by default** | `LISTING_IMPORT_PUBLIC_BROWSER_ENABLED` off; keep it off |
| R10 | Checkout abuse, admin assurance | **Partial** | `checkout` limit 10/10 min fail-closed over guest abuse identity; admin requires AAL2 + TOTP within 15 min. **Gap:** `completeReservedOrder` (accepted-offer checkout) has no `allowAction` call; all other limiters fail open by design |
| R11 | Lossy analytics / search sync | **Addressed** | Consent-gated outbox for purchase events; search outbox with reconcile scripts; Typesense stays optional |
| R12 | Privacy promises vs behaviour | **Fixed** | Signed receipt payload carries `iat`/`exp`; deletion paginates storage in checkpointed pages and throws for retry; `capture()` is a no-op without consent cookie |
| R13 | CSP `unsafe-eval`, admin client boundary | **Fixed** | Production `script-src 'self' 'nonce-…' 'strict-dynamic' https://js.stripe.com`; `supabase/admin.ts` imports `server-only` |
| R14 | Maintainability, docs drift | **Partial** | Commerce actions split; DB types generated and drift-checked in CI. README and several docs are still stale (below) |

## Readiness by dimension

| Dimension | Status | Basis |
|---|---|---|
| Money correctness (capture, payout, refund, dispute, late events) | **Ready for beta** | Verified here in source; 42 SQL guards and Stripe test-mode suite recorded green in CI |
| Release verification | **Gate works; main is red** | Gate refuses unexecuted suites; Chromium + Firefox + WebKit. The last fully green run was on `22c521d`; `d3fe36e` fails one offer-withdraw retry case on two runs |
| Security boundary | **Ready for beta** | RLS is the boundary; invitation gate enforced by DB triggers; admin MFA; nonce CSP; private evidence bucket |
| Operations tooling | **Built, not provisioned** | Health endpoint, alert outbox, recovery queues, restore/rollback scripts exist; no live monitor, no alert destination, no hosted restore |
| Hosted staging | **Does not exist** | Supabase org's two free active slots are occupied (DRVN + Distill); nothing hosted has run the release build |
| Product scope vs PRD | **Exceeds PRD core** | Messaging, saved searches, shops, returns, pickup, admin console and importer all shipped beyond the v3.1 plan; deferred items match the PRD's own "later" list |
| Legal and policy | **Not ready** | Terms hardcode a test-mode clause; no entity, jurisdiction or tax terms; retention durations unapproved across every data family |
| Accessibility | **Automated only** | axe WCAG 2.2 AA on public, account, checkout and admin pages; no screen-reader, device or 200%/400% acceptance |
| Documentation | **Drifting** | README says 28 migrations (there are 104); e2e README describes a superseded setup; PRD status tables are stale |

## What blocks the invited beta

Ordered by dependency. Item 0 is the one in-repo blocker; items 1 and 2 unblock almost everything else.

0. **Get `main` green again.** Diagnose the offer-withdraw retry failure in `e2e/offer-action-recovery.spec.ts:90`. None of the three commits after the last green run (`a7ffe56`, `c2a332b`, `d3fe36e`) touch the offers page or its actions; they change card CSS, the mosaic cell, the engagement strip's `trailing` slot and the preview generator. Either the earlier pass was timing-lucky or the environment changed. Until it passes, the Stripe lane does not run and no candidate has release evidence.
1. **Provision hosted staging.** Free the Supabase organisation slot or pay for a project; never use `drvn-v3` as a fixture target. Configure the canonical HTTPS origin, Stripe test keys, webhook, `CRON_SECRET` ≥ 32 chars, `SENTRY_DSN`, `ADMIN_ALERT_WEBHOOK_URL`. (Tracker R01)
2. **Turn on the monitor.** Set `DRVN_MONITOR_ENABLED`, `DRVN_MONITOR_ORIGIN`, `DRVN_MONITOR_SECRET` in GitHub; pause the staging worker and confirm a real alert arrives. (R07)
3. **Run the real checkout journey on staging.** Payment Element with 3DS success/failure/cancel, a Connect Express seller, delivered-then-refunded order, provider dispute, carrier label if shipping flag is on. (R02, R03, R08)
4. **Legal copy.** Remove or gate the test-mode clause in `src/app/(legal)/terms/page.tsx` (the fees page already gates on `paymentsAreLive()`); add entity, governing law and tax treatment. Being handled outside engineering — confirm it lands before invitations go out.
5. **Retention decisions.** `docs/remediation-data-inventory.md` lists every family with "policy decision still pending". Deletion and export are built to whatever is approved; someone has to approve.
6. **Branch protection.** Upgrade to GitHub Pro or make the repo public; apply the ruleset in the runbook §8 requiring `verify` and `sql-guard`. (R04)
7. **Manual accessibility pass** with named testers on VoiceOver, NVDA or TalkBack and a physical phone, per the boundary in `docs/remediation-action-inventory.md`. (R09)
8. **Hosted restore, load and soak** with agreed RPO/RTO and latency budgets; the local rehearsals (50 s restore, 62 s rollback, 8-way checkout contention) prove the scripts, not the hosting. (R11)
9. **Pilot** with invited buyers and sellers, observation period, then clearing. (R12)

## In-repo work worth doing before or during the pilot

- Add an `allowAction` limiter to `completeReservedOrder` in `src/features/commerce/checkout-actions.ts`. It is authenticated and DB-guarded, but it is a payment-creating path without one.
- Fix documentation drift: README migration range and e2e claims, `e2e/README.md` prerequisites (CI now runs `supabase start` locally), `docs/product-overview.md` "Where we are", and the PRD §10/§13 status tables that still say no Stripe code and no messaging exist.
- Clear the three lint warnings.
- Repo hygiene: a stray tracked `undefined/admin-cases2.png` at the root, 18 tracked screenshots, and a 228 MB `.git`. Consider moving review imagery out of the main tree.
- Decide the shipping flag for beta. `FLAG_INTEGRATED_SHIPPING_V1` is off by default; if it stays off, seller-arranged shipping is the only path and the EasyPost acceptance items in the tracker can be deferred explicitly.
- Keep analytics and Typesense off for the beta, as the release gates document already says.

## What is already strong and should be protected

- The database is the security and money boundary. Reservations, terminal-state guards, refund operations, transfer leases, late-capture compensation and the invitation gate are all enforced in Postgres with guard suites, so an app-layer regression cannot silently move money or open the beta.
- Durable identities for every interrupted request: messages, offers, listings, labels, checkout, admin commands. The 6 September acceptance run covered 27 interruption scenarios with zero retries.
- The release gate is honest. A green build cannot occur without the browser and Stripe suites executing, and the summary job prints what did and did not run.
- The design system is governed: registry, docs sync, route-boundary imports and a recipe ratchet are enforced by tests, which is why 500 lines of card CSS landed today without breaking anything.

## Method and limits

Repository-wide, risk-based review. I ran the static, unit and build checks listed above, read the current source for every 4 September finding, compared the PRD against implemented routes and migrations, and inspected CI history, PR state and GitHub API responses. I did not run the Playwright or Stripe suites locally, touch a hosted Supabase or Stripe account, perform a browser or device audit, or scan git history for secrets. Where I cite counts from CI or evidence files, they are recorded elsewhere and marked as such.
