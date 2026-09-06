# Interrupted-request recovery and atomic writes

Scope: controlled beta with invited buyers and sellers. This batch continues
from `e20c620`; it is separate from that commit's green CI evidence.

## What changes for members

- Messages, reports, questions, activity updates and new listings keep a stable
  submission identity. An interrupted confirmation can be retried without
  creating another copy. Draft text remains available until success is known.
- Gallery changes and modification sheets save complete desired state. Failed
  writes do not leave half a reorder or half a sheet. Uploaded photos awaiting
  attachment can be retried without uploading their bytes again.
- Cart capacity and failed writes are explained. Buy-now navigation follows a
  confirmed cart write; repeated add/remove actions converge on the intended
  contents. Checkout retains the original request, address and selected services
  before payment. Address, quotes and shipment records freeze atomically; retries
  verify payment settlement and can finish a partially settled multi-seller basket.
- New offers and their opening messages commit together. An interrupted response
  reuses that offer, while a database constraint prevents concurrent live duplicates.
- Dispatch, receipt and return transitions commit their related rows together.
  Receipt retries preserve the original payout hold. Accepted-offer checkout
  freezes delivery details before creating the payment and adopts a completed
  payment on retry.
- Outbound and return postage retain the chosen provider shipment before buying
  a label. Uncertain purchases reconcile that identity. Carrier-refund requests
  retain their own identity and credit the seller only after a confirmed refund.
- Password-reset links retain the exchanged session correctly. Email and
  password settings preserve entries after interrupted responses and check
  whether the requested change already happened. Pending email confirmations
  have an explicit resend action.
- Save/like/follow controls use desired state; notification navigation checks
  read persistence and avoids marking messages read through link prefetch.
- Invitation creation uses a valid audit identity, with copy/revoke feedback.
  Car editing shows saved feedback reliably, and gallery controls have enough
  space to receive clicks without overlapping.

## Verification record

Local verification is complete. Candidate-wide GitHub checks are attached to
[PR #2](https://github.com/n89b-dot/DRVN-2/pull/2/checks); their status is separate
from the local evidence below. The initial implementation commit is `b2105e2`.

- Final combined Chromium run: **34 passed**, zero retries, 3.7 minutes. It
  includes interrupted checkout, accepted offers, listings, messages, reports,
  questions, gallery, modifications, activity, settings, invitations, and the
  complete order/return flows.

Other local verification:

- 640 unit tests passed across 96 files; TypeScript passed.
- 104 migrations applied to a fresh disposable database; all 42 SQL guard suites
  passed. Generated database types match that clean schema.
- Lint: zero errors and three existing unused-disable warnings.
- Monitoring/release tooling: 11 passed. Stripe test-mode API: 10 passed.
- Operations: 10 passed across 8 files, including isolated Typesense recovery.
- Production dependency audit: zero reported vulnerabilities.
- Database static lint still reports the runtime-created `_claimed` temporary
  table in `purchase_begin` as missing during static analysis, plus three warnings
  (JSON conversion and unused variables). The clean-schema purchase and recovery
  guards execute that function successfully; static lint is not recorded as clean.

Earlier diagnostic runs are not accepted as final browser evidence:

- First selected browser run: 14 passed, 8 failed, 1 dependent case not run.
- Second selected browser run: 18 passed, 11 failed. Failures included a real
  recursive question-insert permission rule and several ambiguous test selectors.
- Third invocation failed during production startup because newly added RPCs
  were not yet in generated types. No browser test cases ran.
- Fourth selected browser run: 21 passed, 8 failed, 4 dependent cases not run.
  It confirmed activity/message/report/question/social/notification recovery;
  remaining failures included gallery hit-target positioning, lost login input,
  car-save feedback, and incorrect test assumptions about redirect responses.
- Fifth selected browser run: 30 passed, 4 failed. Checkout, dispatch, receipt,
  review, gallery, password reset and account changes passed. Remaining failures
  identified listing transport-error handling, car feedback reset, and two
  locators affected by changing/transitioning feedback. Those were corrected
  before the sixth clean run.
- Sixth selected browser run: 31 passed, 3 failed. Message recovery passed;
  listing creation retained its draft and completed on retry. Invitation revoke
  and listing publish selectors omitted the visible button brackets; car-save
  feedback still needed its dirty state reset. The three affected specs are
  rerun after those corrections.
- The three-case follow-up passed invitation and listing recovery; the car
  status remained hidden. Two focused car runs isolated the cause: the save
  returned success, but standalone `field__ok` text was hidden by CSS. The final
  fix explicitly displays that status and the same invitation status text; all
  temporary diagnostics were removed before the combined run.
- A later fresh database pass applied 101 migrations. All 39 SQL guard suites
  passed after the worker-inventory guard was updated to assert the new family;
  generated-type parity passed. Subsequent cart/offer hardening is being rechecked.
- The unit suite passed 625 tests across 94 files before the final cart/offer
  additions. TypeScript passed, lint had zero errors and three existing warnings,
  and all 11 monitoring/release-tool tests passed.
- Stripe test-mode API checks: 10 passed.
- Local operations checks: 10 passed across 8 files, including real Typesense
  outage recovery. An initial invocation failed because that disposable search
  service was not running; it was started and the full lane rerun.

## Evidence limits

Local stub shipping and browser payment tests exercise application/database
behavior; they do not prove live carrier refund timing, Stripe Connect/3DS,
external email delivery, or hosted operational readiness. The separate hosted
staging environment, repository protection, retention decisions, manual
screen-reader/device testing, hosted restore/load/soak and invited-pilot approval
remain open in the progress tracker. No live production fixtures, paid upgrades,
or external messages were used for this batch.

## Full-candidate CI follow-up

[Run 34002155043](https://github.com/n89b-dot/DRVN-2/actions/runs/34002155043)
on `62dc461` passed database, schema parity, unit/static/build and operations
checks. Browser coverage selected 190 cases: 179 passed, two documented
exclusions, two failures and seven dependent cases unrun, with zero retries.
The release gate failed and the downstream Stripe job did not run.

The traces showed a successful activity publish response while the composer
remained pending, and WebKit losing an email entered before login hydration.
The composer now handles confirmation/navigation directly; controlled login
fields wait for initialization. A delayed-JavaScript regression accompanies
the login fix. Follow-up local and CI results belong to the next candidate.

The follow-up local run passed all **32 Chromium/WebKit cases**, zero retries,
in 2.3 minutes. It includes normal activity publication, interrupted activity
recovery, both full purchase journeys, Auth/security cases and delayed-JavaScript
login initialization. All 640 unit tests, TypeScript and lint (zero errors,
three existing warnings) still pass. Final candidate-wide results are attached
to PR #2; the failed earlier run remains recorded above.

[Run 34003306418](https://github.com/n89b-dot/DRVN-2/actions/runs/34003306418)
on `aa3b84a` passed the corrected activity and WebKit journeys. It selected
193 browser cases: 186 passed, two documented exclusions, one failure and four
dependent cases unrun. Database, unit/static/build and operations checks passed;
the downstream Stripe lane remained gated by the browser failure.

The remaining trace showed a correct listing response and title but an empty
page body after overlapping partial-prefetch requests. Listing cards now fetch
on activation by default. The feature regression asserts that navigation renders
the heading and part number without speculative listing requests. Three complete
local repetitions passed all **18 cases**, zero retries, in 1.0 minute. Unit tests
remain 640 passing; TypeScript and lint still pass with the same three warnings.

[Run 34004319348](https://github.com/n89b-dot/DRVN-2/actions/runs/34004319348)
on `602d924` passed listing navigation but exposed two remaining pending-state
failures in invitation creation and WebKit dispatch replay. Browser results:
193 selected, 187 passed, two documented exclusions, two failures and two
dependent cases unrun; zero retries. Database, unit/static/build and operations
lanes passed; Stripe remained gated.

Both traces contained completed server responses while their forms stayed
pending. Invitation create/revoke and order dispatch/receipt/cancellation now
own their submission state explicitly. The shared confirmation dialog supports
this client submission path without changing existing form-action callers.
Required fields and duplicate-submit guards remain enforced; transport errors
retain entered details and show recovery guidance.

The invitation and full purchase flows passed twice locally across Chromium
and WebKit: **34 passed**, zero retries, 2.1 minutes. Unit/static checks remain
640 passing tests, successful TypeScript, and zero lint errors (three existing
warnings). The next candidate's full CI result remains attached to PR #2.
