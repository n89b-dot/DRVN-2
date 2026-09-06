# Critical mutation and accessibility inventory

Prepared 2026-09-05 for R09. This inventory names the mutation boundary and
the regression that exercises the user journey. “Partial” is deliberate: a
nearby unit test or a rendered page does not count as mutation evidence.

The interrupted-request specs passed the final combined 34-case Chromium run
with zero retries. All 42 SQL guard suites passed against a fresh schema.
The [evidence record](readiness-progress/evidence/2026-09-05-interrupted-request-recovery.md)
describes local results and limits; candidate-wide checks are attached to
[PR #2](https://github.com/n89b-dot/DRVN-2/pull/2/checks).

| Journey | Server / database boundary | Current regression evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Email/password sign-up and onboarding | `src/app/(auth)/actions.ts`; `handle_new_user()`; beta claim trigger | `e2e/marketplace-family.spec.ts`; `supabase/tests/beta_access_guard.sql` | Hosted confirmation-email delivery and invitation acceptance |
| Login, logout, password reset/change | `src/app/(auth)/actions.ts` | Login/logout repeat across browser suites; `e2e/remediation-security.spec.ts` tests captured reset-link success, expiry and reuse | Hosted email delivery and provider acceptance |
| OAuth callback and new-user onboarding | `src/app/(auth)/callback/route.ts` | Redirect safety in `src/lib/safe-redirect.test.ts` | Hosted provider success, denial, and duplicate callback |
| Admin MFA enrollment/recovery/revocation | auth verify actions; `begin_admin_mfa_recovery()` | `e2e/remediation-security.spec.ts`; `supabase/tests/admin_guard.sql` | Physical recovery runbook exercise remains manual |
| Create/edit/delete a car | `src/app/(product)/garage/actions.ts` | `e2e/add-car.spec.ts`; `e2e/mobile-matrix.spec.ts`; `e2e/mod-sheet-recovery.spec.ts` checks edit/delete response loss, retained drafts, replay, reload and confirmed deletion | Invited-pilot acceptance |
| Gallery upload/delete/reorder/cover/alt/focal | garage actions; normalized media route; storage RLS | `e2e/garage-sell-lifecycle.spec.ts`; `e2e/gallery-recovery.spec.ts`; `e2e/gallery-upload-response-loss.spec.ts` checks disabled pre-hydration input, committed upload response loss, single attachment and orphan GC; `supabase/tests/car_gallery_consistency_guard.sql`; media unit/SQL guards | Physical-device camera/upload acceptance remains manual |
| Create/edit/delete activity update | garage activity actions; composer actions; atomic activity RPC | `e2e/garage-sell-lifecycle.spec.ts`; `e2e/activity-recovery.spec.ts` checks draft restoration plus publish/edit/delete response loss, retry and reload; `supabase/tests/activity_write_guard.sql`; composer/action unit coverage | Invited-pilot acceptance |
| Save/edit/reorder modification lines | `saveModItems()` and atomic modification-sheet RPC | `e2e/mobile-remediation.spec.ts`; `e2e/mod-sheet-recovery.spec.ts`; `supabase/tests/mod_sheet_atomic_guard.sql` | Invited-pilot acceptance |
| Create or publish listing | `src/app/(product)/sell/actions.ts`; durable listing request; listing beta/status triggers | `e2e/golden-path.spec.ts`; `e2e/garage-sell-lifecycle.spec.ts`; `e2e/listing-recovery.spec.ts`; `supabase/tests/listing_creation_request_guard.sql` plus security/beta guards | Invited-pilot acceptance |
| Pause/reactivate/delete listing | `setListingStatus()` / `deleteListing()`; status/delete triggers | `e2e/mobile-matrix.spec.ts`; `e2e/listing-recovery.spec.ts` checks committed publish/pause/reactivate/delete response loss and replay; `supabase/tests/security_guard.sql` | Invited-pilot acceptance |
| Import URL/paste/select item/save draft | sell import actions and worker | `e2e/listing-import.spec.ts` checks a lost response after a committed worker step plus reload and mobile paste review; importer unit/SQL guards | Invited-pilot acceptance |
| Add/remove cart and buy-now navigation | `src/features/commerce/cart-actions.ts`; signed cookie | `e2e/discovery-remediation.spec.ts`; `e2e/guest-checkout.spec.ts` outside beta; `e2e/cart-recovery.spec.ts`; cart action unit tests | Hosted browser/cookie acceptance  |
| Cart checkout reservation and payment initiation | `checkoutCart()`; `purchase_begin()`; payment request journal; atomic shipping freeze | `e2e/golden-path.spec.ts`; `supabase/tests/cart_checkout_replay_guard.sql`; `supabase/tests/cart_checkout_shipping_freeze_guard.sql`; purchase/money guards; Stripe tests | Hosted Payment Element/3DS, provider-response interruption |
| Accepted-offer checkout | `completeReservedOrder()`; accepted-offer shipping freeze; payment request journal | `e2e/accepted-offer-recovery.spec.ts`; `supabase/tests/accepted_offer_checkout_guard.sql`; checkout action/shipping unit tests | Hosted payment/3DS  |
| Create/withdraw/counter/accept/decline offer | offer actions; atomic offer-and-opening-message RPC; `offer_accept_begin()`; offer triggers | `e2e/marketplace-family.spec.ts`; `e2e/offer-submission-recovery.spec.ts`; `e2e/offer-action-recovery.spec.ts` interruption matrix; `supabase/tests/durable_offer_submission_guard.sql`; security SQL guard | Invited-pilot acceptance |
| Thread and offer messages | message actions; stable message identity; message RLS/immutability trigger | `e2e/message-recovery.spec.ts` checks offer and order-thread draft retention, committed response loss, retry and reload; conversation action/unit/SQL coverage; golden path navigation | Invited-pilot acceptance |
| Mark dispatched / received | fulfillment actions and atomic order transition RPCs | `e2e/golden-path.spec.ts` committed-response retry; transaction-completion suite; order-fulfillment unit tests; `supabase/tests/order_fulfillment_transition_guard.sql` | Invited-pilot acceptance |
| Pickup pass issue/redeem/confirm | pickup actions and atomic pickup RPCs | `e2e/transaction-completion.spec.ts`; pickup SQL guard | Camera/physical-device and offline failure remain manual |
| Shipping quote/label/tracking/delivery | shipping actions, EasyPost route, durable outbound/return label and label-void journals, shipment RPCs | transaction-completion browser; outbound/return label and void unit tests; `supabase/tests/outbound_label_request_guard.sql`; `supabase/tests/return_label_request_guard.sql`; `supabase/tests/outbound_label_void_guard.sql`; shipping webhook unit tests | Live carrier purchase/refund callbacks, manual provider reconciliation acceptance |
| Open/escalate/settle dispute | dispute actions/route and atomic admin command | transaction-completion browser; `e2e/dispute-recovery-matrix.spec.ts`; `e2e/return-dispute-recovery.spec.ts`; dispute command/unit and SQL guards | Hosted provider dispute outcomes |
| Propose/approve/ship/receive/cancel return | return actions; atomic return workflow RPCs; durable return-label request | transaction-completion browser; `e2e/return-dispute-recovery.spec.ts` failure/retry coverage; return helper/unit coverage; `supabase/tests/atomic_return_workflows_guard.sql`; `supabase/tests/return_label_request_guard.sql` | Live carrier transitions and callbacks |
| Review and listing question | feedback actions; stable question identity; RLS | golden path review; `e2e/feedback-settings-recovery.spec.ts` question recovery; feedback action tests; `supabase/tests/listing_question_rls_guard.sql`; security guard | Invited-pilot acceptance  |
| Save, like, follow, and remove | `src/features/social/actions.ts`; atomic desired-state RPC; per-user RLS | `e2e/social-notification-recovery.spec.ts`; social action tests; `supabase/tests/social_mutation_consistency_guard.sql`; security guard | Invited-pilot acceptance |
| File a listing or user report | `src/features/moderation/actions.ts`; stable report identity; report RLS and rate limit | `e2e/report-recovery.spec.ts` checks response loss, invalid and rate-limited drafts; `e2e/admin-mutation-recovery.spec.ts` checks admin visibility and resolution; moderation action tests; report RLS in the security guard | Invited-pilot acceptance |
| Mark one/all notifications read | notification action/open route; atomic notification mutations; notification RLS | `e2e/social-notification-recovery.spec.ts` checks individual and mark-all failure, retry and reload; notification action/route tests; notification SQL guards | Invited-pilot acceptance |
| Saved cards add/remove | payment-method actions/provider | provider unit tests; settings renders card list | Hosted setup-intent and remove failure/reload |
| Profile, preferences, email, password, consent | garage/settings/account actions; consent RPC | authenticated axe scan; `e2e/account-settings-recovery.spec.ts`; analytics, profile and retained invalid-input matrix in `e2e/feedback-settings-recovery.spec.ts`; account/consent action tests; consent SQL guard | Hosted delivered email-link expiry/reuse |
| Account export | export route/worker and signed download | `e2e/account-export.spec.ts`; export contract/unit checks | Concurrent mutation hosted acceptance |
| Account deletion | deletion request/worker and storage checkpoints | `e2e/remediation-security.spec.ts`; deletion SQL/operation tests | Hosted Auth/Storage failure injection and completion notice |
| Admin moderation/users/reports/cases | admin actions and `execute_admin_command()` | `e2e/admin-mutation-recovery.spec.ts` checks listing removal/restore, user suspension, notes, report resolution, case interruption/reload and viewer denial; admin SQL guards; admin pages automated axe scan | Invited-operator acceptance |
| Admin financial commands | fenced admin actions, durable provider operations and recovery journals | `e2e/admin-mutation-recovery.spec.ts` checks local recovery-case closure and reload; money unit/SQL/operations suites, including refund replacement/reversal, dispute ordering, transfer recovery and label-void guards | Hosted provider interruption, manual reconciliation drills, and operator recovery |
| Beta invitation issue/revoke | invitation admin action; invitation/membership triggers | `e2e/beta-invitations.spec.ts`; `supabase/tests/beta_access_guard.sql`; invitation unit coverage | Hosted invite delivery/acceptance |

## Expanded local acceptance — 2026-09-06

The remaining local matrix passes 27 Chromium cases with zero retries and two
existing URL-import SSRF exclusions. It covers the interruption and reload
scenarios named above, including administrative command families. See the
[completion evidence](readiness-progress/evidence/2026-09-06-local-acceptance-completion.md)
for operational rehearsals, validation and external acceptance boundaries.

## Feedback and duplicate-submit contract

The required contract is immediate pending feedback with submission disabled,
plus errors and success results rendered adjacent to the action through
`ResultNote`, `role="alert"`, `role="status"`, or an equivalent live region.
Financial actions additionally require a durable idempotency or operation
identity before the provider call; the inventory does not treat a disabled
button as financial duplicate protection.

The open rows above are release work. They cannot be converted to “covered” by
test counts, a stub provider result, or an automated accessibility scan.

## Accessibility evidence boundary

Automated browser coverage currently gates all applicable axe WCAG 2.0/2.1
A/AA and 2.2 AA rules on public pages, authenticated account/settings/garage,
the garage dialog, checkout, and authenticated admin pages. Keyboard checks
cover signup and nested-dialog focus return. Playwright does not satisfy the
manual VoiceOver, NVDA, TalkBack, physical-device, 200% text, 400% reflow,
rotation, camera/upload, contrast, touch-target, and complete-process matrix in
R09; those results need named testers, platform versions, findings, fixes, and
rechecks.

## Automated evidence — 2026-09-05

The final Chromium run used zero retries:

```sh
E2E_DIAGNOSTIC_RETRIES=0 npx playwright test e2e/a11y.spec.ts e2e/remediation-security.spec.ts --project=chromium --grep 'axe:|keyboard-only|authenticated account|authenticated cart|admin access'
```

Result: 9 passed in 2.4 minutes. The run covered five public axe scans, the
signup keyboard order and announced server-auth error, authenticated
account/settings/garage/orders/selling plus the garage dialog, authenticated
cart/checkout at desktop and a 320 CSS-pixel reflow viewport, and
MFA-authenticated admin overview/invitations plus recovery and revocation.

Two earlier clean-run invocations exited before test dispatch when the
production web server exceeded its 120-second startup limit. They are startup
failures and contribute no passing or failing test cases to the result above.
Playwright therefore allows up to 300 seconds for production-server startup
on a developer machine while CI retains its 120-second startup limit. This
changes neither test timeouts nor assertions, and release runs still use zero
retries.
