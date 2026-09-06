# Critical mutation and accessibility inventory

Prepared 2026-09-05 for R09. This inventory names the mutation boundary and
the regression that exercises the user journey. “Partial” is deliberate: a
nearby unit test or a rendered page does not count as mutation evidence.

The newly listed interrupted-request browser specs passed the final combined
34-case Chromium run with zero retries. All 42 SQL guard suites passed against
a fresh schema. Candidate-wide GitHub verification is still pending. Its
result must be recorded in
[`readiness-progress/evidence/2026-09-05-interrupted-request-recovery.md`](readiness-progress/evidence/2026-09-05-interrupted-request-recovery.md)
before any of these additions are treated as a final browser pass.

| Journey | Server / database boundary | Current regression evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Email/password sign-up and onboarding | `src/app/(auth)/actions.ts`; `handle_new_user()`; beta claim trigger | `e2e/marketplace-family.spec.ts`; `supabase/tests/beta_access_guard.sql` | Hosted confirmation-email delivery and expired invite UI |
| Login, logout, password reset/change | `src/app/(auth)/actions.ts` | Login/logout repeat across browser suites; reset-link enumeration behavior is code-reviewed | Add delivered reset-link expiry/reuse browser case |
| OAuth callback and new-user onboarding | `src/app/(auth)/callback/route.ts` | Redirect safety in `src/lib/safe-redirect.test.ts` | Hosted provider success, denial, and duplicate callback |
| Admin MFA enrollment/recovery/revocation | auth verify actions; `begin_admin_mfa_recovery()` | `e2e/remediation-security.spec.ts`; `supabase/tests/admin_guard.sql` | Physical recovery runbook exercise remains manual |
| Create/edit/delete a car | `src/app/(product)/garage/actions.ts` | `e2e/add-car.spec.ts`; `e2e/mobile-matrix.spec.ts` | Failed write and lost-response replay for edit/delete |
| Gallery upload/delete/reorder/cover/alt/focal | garage actions; normalized media route; storage RLS | `e2e/garage-sell-lifecycle.spec.ts`; `e2e/gallery-recovery.spec.ts`; `supabase/tests/car_gallery_consistency_guard.sql`; media unit/SQL guards | Upload-byte completion after network loss and final combined browser validation |
| Create/edit/delete activity update | garage activity actions; composer actions; atomic activity RPC | `e2e/garage-sell-lifecycle.spec.ts`; `e2e/activity-recovery.spec.ts`; `supabase/tests/activity_write_guard.sql`; composer/action unit coverage | Edit/delete persistence after reload and final combined browser validation |
| Save/edit/reorder modification lines | `saveModItems()` and atomic modification-sheet RPC | `e2e/mobile-remediation.spec.ts`; `e2e/mod-sheet-recovery.spec.ts`; `supabase/tests/mod_sheet_atomic_guard.sql` | Final combined browser validation |
| Create or publish listing | `src/app/(product)/sell/actions.ts`; durable listing request; listing beta/status triggers | `e2e/golden-path.spec.ts`; `e2e/garage-sell-lifecycle.spec.ts`; `e2e/listing-recovery.spec.ts`; `supabase/tests/listing_creation_request_guard.sql` plus security/beta guards | Final combined browser validation |
| Pause/reactivate/delete listing | `setListingStatus()` / `deleteListing()`; status/delete triggers | `e2e/mobile-matrix.spec.ts`; `supabase/tests/security_guard.sql` | Repeat activation and failed server response in browser |
| Import URL/paste/select item/save draft | sell import actions and worker | `e2e/listing-import.spec.ts`; importer unit/SQL guards | Worker response lost after committed step |
| Add/remove cart and buy-now navigation | `src/features/commerce/cart-actions.ts`; signed cookie | `e2e/discovery-remediation.spec.ts`; `e2e/guest-checkout.spec.ts` outside beta; `e2e/cart-recovery.spec.ts`; cart action unit tests | Cookie-write failure and final combined browser validation |
| Cart checkout reservation and payment initiation | `checkoutCart()`; `purchase_begin()`; payment request journal; atomic shipping freeze | `e2e/golden-path.spec.ts`; `supabase/tests/cart_checkout_replay_guard.sql`; `supabase/tests/cart_checkout_shipping_freeze_guard.sql`; purchase/money guards; Stripe tests | Hosted Payment Element/3DS, provider-response interruption, and final combined browser validation |
| Accepted-offer checkout | `completeReservedOrder()`; accepted-offer shipping freeze; payment request journal | `e2e/accepted-offer-recovery.spec.ts`; `supabase/tests/accepted_offer_checkout_guard.sql`; checkout action/shipping unit tests | Hosted payment/3DS and final combined browser validation |
| Create/withdraw/counter/accept/decline offer | offer actions; atomic offer-and-opening-message RPC; `offer_accept_begin()`; offer triggers | `e2e/marketplace-family.spec.ts`; `e2e/offer-submission-recovery.spec.ts`; `supabase/tests/durable_offer_submission_guard.sql`; security SQL guard | Counter/accept/decline/withdraw interruption matrix and final combined browser validation |
| Thread and offer messages | message actions; stable message identity; message RLS/immutability trigger | `e2e/message-recovery.spec.ts`; conversation action/unit/SQL coverage; golden path navigation | Offer-thread interruption acceptance and final combined browser validation |
| Mark dispatched / received | fulfillment actions and atomic order transition RPCs | `e2e/golden-path.spec.ts` committed-response retry; transaction-completion suite; order-fulfillment unit tests; `supabase/tests/order_fulfillment_transition_guard.sql` | Final combined browser validation |
| Pickup pass issue/redeem/confirm | pickup actions and atomic pickup RPCs | `e2e/transaction-completion.spec.ts`; pickup SQL guard | Camera/physical-device and offline failure remain manual |
| Shipping quote/label/tracking/delivery | shipping actions, EasyPost route, durable outbound/return label and label-void journals, shipment RPCs | transaction-completion browser; outbound/return label and void unit tests; `supabase/tests/outbound_label_request_guard.sql`; `supabase/tests/return_label_request_guard.sql`; `supabase/tests/outbound_label_void_guard.sql`; shipping webhook unit tests | Live carrier purchase/refund callbacks, manual provider reconciliation acceptance, and final combined browser validation |
| Open/escalate/settle dispute | dispute actions/route and atomic admin command | transaction-completion browser; dispute command/unit and SQL guards | Hosted provider dispute outcomes and lost-response UI |
| Propose/approve/ship/receive/cancel return | return actions; atomic return workflow RPCs; durable return-label request | transaction-completion browser; return helper/unit coverage; `supabase/tests/atomic_return_workflows_guard.sql`; `supabase/tests/return_label_request_guard.sql` | Live carrier transitions, failure/retry browser matrix, and final combined browser validation |
| Review and listing question | feedback actions; stable question identity; RLS | golden path review; `e2e/feedback-settings-recovery.spec.ts` question recovery; feedback action tests; `supabase/tests/listing_question_rls_guard.sql`; security guard | Duplicate-review and review-failure browser cases plus final combined browser validation |
| Save, like, follow, and remove | `src/features/social/actions.ts`; atomic desired-state RPC; per-user RLS | `e2e/social-notification-recovery.spec.ts`; social action tests; `supabase/tests/social_mutation_consistency_guard.sql`; security guard | Final combined browser validation |
| File a listing or user report | `src/features/moderation/actions.ts`; stable report identity; report RLS and rate limit | `e2e/report-recovery.spec.ts`; moderation action tests; report RLS in the security guard | Invalid/rate-limit and admin-visibility browser acceptance plus final combined validation |
| Mark one/all notifications read | notification action/open route; atomic notification mutations; notification RLS | `e2e/social-notification-recovery.spec.ts`; notification action/route tests; notification SQL guards | Mark-all failure/reload browser acceptance and final combined validation |
| Saved cards add/remove | payment-method actions/provider | provider unit tests; settings renders card list | Hosted setup-intent and remove failure/reload |
| Profile, preferences, email, password, consent | garage/settings/account actions; consent RPC | authenticated axe scan; `e2e/account-settings-recovery.spec.ts`; analytics/profile cases in `e2e/feedback-settings-recovery.spec.ts`; account/consent action tests; consent SQL guard | Delivered email-link expiry/reuse, remaining invalid-input matrix, and final combined browser validation |
| Account export | export route/worker and signed download | `e2e/account-export.spec.ts`; export contract/unit checks | Concurrent mutation hosted acceptance |
| Account deletion | deletion request/worker and storage checkpoints | `e2e/remediation-security.spec.ts`; deletion SQL/operation tests | Hosted Auth/Storage failure injection and completion notice |
| Admin moderation/users/reports/cases | admin actions and `execute_admin_command()` | admin SQL guards; admin pages automated axe scan | Browser mutation success/error/reload per command family |
| Admin financial commands | fenced admin actions, durable provider operations and recovery journals | money unit/SQL/operations suites, including refund replacement/reversal, dispute ordering, transfer recovery and label-void guards | Hosted provider interruption, manual reconciliation drills, and operator recovery |
| Beta invitation issue/revoke | invitation admin action; invitation/membership triggers | `e2e/beta-invitations.spec.ts`; `supabase/tests/beta_access_guard.sql`; invitation unit coverage | Final combined browser validation and hosted invite delivery/acceptance |

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
