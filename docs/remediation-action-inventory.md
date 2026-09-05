# Critical mutation and accessibility inventory

Prepared 2026-09-05 for R09. This inventory names the mutation boundary and
the regression that exercises the user journey. “Partial” is deliberate: a
nearby unit test or a rendered page does not count as mutation evidence.

| Journey | Server / database boundary | Current regression evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Email/password sign-up and onboarding | `src/app/(auth)/actions.ts`; `handle_new_user()`; beta claim trigger | `e2e/marketplace-family.spec.ts`; `supabase/tests/beta_access_guard.sql` | Hosted confirmation-email delivery and expired invite UI |
| Login, logout, password reset/change | `src/app/(auth)/actions.ts` | Login/logout repeat across browser suites; reset-link enumeration behavior is code-reviewed | Add delivered reset-link expiry/reuse browser case |
| OAuth callback and new-user onboarding | `src/app/(auth)/callback/route.ts` | Redirect safety in `src/lib/safe-redirect.test.ts` | Hosted provider success, denial, and duplicate callback |
| Admin MFA enrollment/recovery/revocation | auth verify actions; `begin_admin_mfa_recovery()` | `e2e/remediation-security.spec.ts`; `supabase/tests/admin_guard.sql` | Physical recovery runbook exercise remains manual |
| Create/edit/delete a car | `src/app/(product)/garage/actions.ts` | `e2e/add-car.spec.ts`; `e2e/mobile-matrix.spec.ts` | Failed write and lost-response replay for edit/delete |
| Gallery upload/delete/reorder/cover/alt/focal | garage actions; normalized media route; storage RLS | `e2e/garage-sell-lifecycle.spec.ts`; media unit/SQL guards | Network-loss replay for reorder and upload completion |
| Create/edit/delete activity update | garage activity actions; composer actions | `e2e/garage-sell-lifecycle.spec.ts`; composer unit coverage | Edit/delete persistence after reload and failed publish |
| Save/edit/reorder modification lines | `saveModItems()` and listing link actions | `e2e/mobile-remediation.spec.ts` | Failed write plus adjacent unsaved-line preservation |
| Create or publish listing | `src/app/(product)/sell/actions.ts`; listing beta/status triggers | `e2e/golden-path.spec.ts`; `e2e/garage-sell-lifecycle.spec.ts`; SQL security/beta guards | Lost response after committed publish |
| Pause/reactivate/delete listing | `setListingStatus()` / `deleteListing()`; status/delete triggers | `e2e/mobile-matrix.spec.ts`; `supabase/tests/security_guard.sql` | Repeat activation and failed server response in browser |
| Import URL/paste/select item/save draft | sell import actions and worker | `e2e/listing-import.spec.ts`; importer unit/SQL guards | Worker response lost after committed step |
| Add/remove cart and buy-now navigation | `src/features/commerce/cart-actions.ts`; signed cookie | `e2e/discovery-remediation.spec.ts`; `e2e/guest-checkout.spec.ts` outside beta | Repeat activation and cookie-write failure |
| Cart checkout reservation and payment initiation | `checkoutCart()`; `purchase_begin()`; payment request journal | `e2e/golden-path.spec.ts`; purchase/money SQL guards; Stripe tests | Hosted Payment Element/3DS, reload, lost response, and repeat-submit acceptance |
| Accepted-offer checkout | `completeReservedOrder()`; payment request journal | Offer SQL guards and general checkout coverage | Dedicated browser success/failure/refresh case |
| Create/withdraw/counter/accept/decline offer | offer actions; `offer_accept_begin()`; offer triggers | marketplace-family browser flow plus security SQL guard | Full counter/accept browser journey and lost-response replay |
| Thread and offer messages | message actions; message RLS/immutability trigger | conversation unit/SQL coverage and golden path navigation | Browser send failure, duplicate submit, and announcement |
| Mark dispatched / received | fulfillment actions and order transition RPCs | `e2e/golden-path.spec.ts`; transaction-completion suite | Failed transition and response-lost replay in browser |
| Pickup pass issue/redeem/confirm | pickup actions and atomic pickup RPCs | `e2e/transaction-completion.spec.ts`; pickup SQL guard | Camera/physical-device and offline failure remain manual |
| Shipping quote/label/tracking/delivery | shipping actions, EasyPost route, shipment RPCs | transaction-completion browser; shipping webhook unit tests | Hosted provider label/refund evidence |
| Open/escalate/settle dispute | dispute actions/route and atomic admin command | transaction-completion browser; dispute command/unit and SQL guards | Hosted provider dispute outcomes and lost-response UI |
| Propose/approve/ship/receive/cancel return | return actions and return RPCs | transaction-completion browser; returns unit and SQL guards | Failure/retry at every carrier/provider transition |
| Review and listing question | feedback actions and RLS | golden path review; security SQL guard | Question error/retry and duplicate review browser cases |
| Save, like, follow, and remove | `src/features/social/actions.ts`; per-user RLS | Affordance/layout browser checks; security SQL guard | Browser mutation, failed toggle, repeat activation, and reload persistence |
| File a listing or user report | `src/features/moderation/actions.ts`; report RLS and rate limit | Report RLS in the security SQL guard | Reporter-side success, invalid/rate-limit/failure announcement, and admin visibility |
| Mark one/all notifications read | notification action/open route; notification RLS | Notification filter/reflow browser checks; purchase notification SQL guard | Browser mutation, read-state persistence, and failed update feedback |
| Saved cards add/remove | payment-method actions/provider | provider unit tests; settings renders card list | Hosted setup-intent and remove failure/reload |
| Profile, preferences, email, password, consent | garage/settings/account actions; consent RPC | authenticated axe scan; consent SQL guard | Browser invalid/failure/persisted-success matrix |
| Account export | export route/worker and signed download | `e2e/account-export.spec.ts`; export contract/unit checks | Concurrent mutation hosted acceptance |
| Account deletion | deletion request/worker and storage checkpoints | `e2e/remediation-security.spec.ts`; deletion SQL/operation tests | Hosted Auth/Storage failure injection and completion notice |
| Admin moderation/users/reports/cases | admin actions and `execute_admin_command()` | admin SQL guards; admin pages automated axe scan | Browser mutation success/error/reload per command family |
| Admin financial commands | fenced admin actions, durable provider operations | money unit/SQL/operations suites | Hosted provider interruption and operator recovery |
| Beta invitation issue/revoke | invitation admin action; invitation/membership triggers | `supabase/tests/beta_access_guard.sql`; primitive unit test | Browser admin create/copy/revoke and hosted invite acceptance |

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
