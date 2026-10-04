# Release readiness, round four: implementation record (4–5 October 2026)

Round four closes the remaining code P2 and P3 items from the 3 October readiness review
(see `2026-10-release-r3-record.md` for round three). It is not a release approval.
The owner items are still open: hosting, email, Stripe live endpoints, branch protection,
counsel review, and the untracked-shipment rule.

## Findings closed in code

| Finding | What changed | Evidence |
|---|---|---|
| No app-level login/reset throttle | Sign-in and password reset are limited by a hash of the email and by the client network, the latter only when it is trustworthy. Neither limit reveals whether an account exists. | `(auth)/actions.test.ts` |
| All guests share one rate-limit bucket | On Vercel, `x-vercel-forwarded-for` / `x-forwarded-for` are trusted (Vercel overwrites them). Elsewhere they need `TRUST_PROXY_HEADERS=true`. Live production warns when there is no trusted source. | `abuse-identity` and `env` tests |
| Message photos could keep GPS data | Message photos go through the server re-encode (all metadata dropped). The server checks the `<you>/<recipient>` path. Client uploads into the bucket are refused (`20261005100000`). Dispute evidence is unchanged, deliberately. | `message_photo_normalization_guard.sql`; public-photo route tests |
| Guest checkout attached orders to any typed member email | A guest checkout using a confirmed member's email is refused ("sign in to buy with it"). Orders for unconfirmed buyers are recorded, and a seller can't review the buyer on them (`20261005101000`). **Owner decision (4 Oct, Neil): keep the refusal.** It tells a visitor the address is registered; signup already does, and checkout's rate limit slows probing. | `guest_buyer_review_guard.sql`; `e2e/guest-checkout.spec.ts` updated |
| Comment, reaction and follow spam | The defined limits are applied to comments and reactions; a new limit covers follows. Removals are never limited. | Activity and social action tests |
| Unsuspend ignored a pending account deletion | `execute_admin_command`'s `user.unsuspend` refuses while a deletion job is pending, processing or failed (`20261005102000`). The diff against the live definition shows only that branch changed. | `unsuspend_deletion_guard.sql` |
| Apple Pay / Google Pay blocked | `Permissions-Policy: payment=(self "https://js.stripe.com")`. Verify on a real device. | `security-headers.test.ts` |
| Accepted offers charged shipping on collection | Collection is checked, and shipping and the fee are recalculated on goods alone. Charge bounds still apply. The freeze returns the total the worker then charges (`20261005110000`). | `accepted_offer_collection_guard.sql`; checkout tests |
| Seller label costs never collected | `seller_carry_entries`, an append-only ledger with one entry per fact. A later transfer keeps back what is owed, frozen before dispatch and serialised per seller. Reversals are capped at the amount sent, with the shortfall carried. The ledger and order page say where label costs went (`20261005110100`). | `seller_carry_forward_guard.sql` (9 sections); worker, proceeds, ledger and carry tests |
| Refund resume queue stall | Due operations are filtered before the limit, oldest-touched first. | `refund-resume.test.ts` |
| Unchecked notification and outbox writes | Errors are checked and reported; no money action fails because of them. The alert outbox claims a lease before sending and carries an idempotency key. | `alerts`, `offer-actions` and `stripe` tests |
| Ledger display | Totals add what each payout pays; the amount owed is shown separately. Fee and seller share are shown separately on refunds. | Ledger tests |
| Forms crashed on a lost response | Label buy/void, pickup, account deletion and payout setup use the recoverable-action pattern. A lost answer shows "Reload to check" and never offers a destructive action twice. Listing deletion already converged on retry and is unchanged. | `UnconfirmedOutcome` component (registered) |
| Beta-check outage said "invite-only" | Checkout, Sell, Import, Buy and the cart say the check failed and to try again, and still deny access. | |
| Post page had no metadata | `generateMetadata`, with private or unpublished posts made generic and noindex. | |
| Slow pages | Order detail is two parallel rounds instead of about nine sequential reads; the listing page is one round shorter. | |
| Smaller UX | Human status names; Saved shows follow failures; muted notifications are filtered in the query; error pages use components and sensible exits; the Stripe onboarding return handles expired links and leads back to drafts. | `notification-prefs.test.ts` |
| Hygiene | The 23 stale `as never` RPC casts are typed. `@types/qrcode` moved to dev dependencies (`cheerio` and `jsdom` are used at runtime). The stray `undefined/` screenshot is removed. Seed scripts read `DRVN_SEED_PASSWORD`; the old password is still in git history, so rotate it. | |
| Design-system debt (bounded) | The profile dialog is rebuilt from components; the `btn` recipe count drops from 51 to 43. | Recipe ratchet |

## Verification on this branch

- Every replaced database function was diffed: additions only, marked with their migration number.
- SQL: agents ran all 67 guards on fresh databases. Before merging, CI's `sql-guard` job re-runs them from a clean database.
- Generated types are regenerated (additions only); the two temporary casts are replaced with typed calls.
- `npx tsc --noEmit` and ESLint are clean; `npm test` passes 947 tests in 139 files.
- Browser: CI runs the full suite. Local runs were unreliable because the machine was overloaded (auth and database timeouts on the shared stack).

## Still open

- **Owner:** hosting, email provider, Stripe live endpoints, branch protection, counsel review and retention periods, the untracked-shipment auto-confirm rule, paying sellers before return and dispute windows close, a real-device wallet check, and rotating the old seed password.
- **Code:**
  - A positive carry-forward balance is never paid out.
  - No backfill of payouts that closed before carry-forward existed.
  - `seller_carry_entries` is not yet in the account export.
  - About 120 raw design-system recipe uses remain.
  - `feedback-actions` shows a generic error when a review is refused, and the order page should use `order_buyer_reviewable` to hide that form.
