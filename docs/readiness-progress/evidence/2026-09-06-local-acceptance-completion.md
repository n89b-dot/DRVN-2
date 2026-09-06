# Remaining local acceptance work

Scope: invited buyers and sellers; disposable local DRVN services only. This
record distinguishes executed checks from hosted and human acceptance.

## Implementation

- Offer decisions recognize authorized exact replays of committed counters,
  declines and accepted orders. Offer, return and dispute forms use explicit
  submissions so failed requests cannot reset uncontrolled inputs.
- Car and activity deletion return confirmed destinations. Failed activity
  lookups return an error rather than falsely confirming an absent record.
- Admin confirmation dialogs and case controls own pending state, retain
  entered reasons/labels after interrupted responses, announce results and
  advise reloading before issuing another potentially state-changing command.
- Build-story editing now renders the server's saved confirmation. Profile
  fields retain corrections when validation rejects a submission.
- Photo selection stays disabled until the browser has installed its upload
  handlers. A lost committed upload leaves a tracked orphan; retry attaches
  one photo, and garbage collection removes only the unused object.

The expanded browser matrix covers content edits/deletion, listing state,
media upload response loss and orphan cleanup, import worker response loss,
notification mark-all, settings validation, report validation/rate limits,
order messages, offer decisions, returns/disputes, and administrative command
families. The final selected Chromium matrix passed 27 cases with zero retries;
two existing URL-import SSRF exclusions remained explicitly skipped. The run
used the production build from the preceding verification with only fixture
and assertion corrections afterward (1.8 minutes).

Final local checks: 645 unit tests across 96 files, TypeScript, production build,
and lint (zero errors, three existing warnings). All 11 operations tests across
nine files and 11 monitor/release-tool tests passed. The fresh-schema rehearsal
applied 104 migrations and passed all 42 SQL guards. Production dependency audit
reported zero vulnerabilities. Candidate-wide CI is recorded against the exact
commit in [PR #2 checks](https://github.com/n89b-dot/DRVN-2/pull/2/checks).

Earlier browser failures exposed an action-refresh sequencing race in the test
and truncated fixture usernames; both were corrected before this passing run.
A separate review fixed committed counter replay after the asking price changes,
with a dedicated unit regression.

## Executed operational rehearsals

- [Database/object restore](2026-09-06-local-recovery.json): complete 104-migration
  synthetic database, 87 matching restored table fingerprints, identical object
  bytes and verified Storage row reference. Outbound configuration cleared, no
  active schedules. Setup and rehearsal completed in 50 seconds.
- [Application rollback](2026-09-06-local-rollback.json): previous artifact
  `1ca2b27`, identical dependencies, seven tests across six recovery suites against
  current local schema, successful production build, four public pages and
  denied anonymous admin access. Completed in 62 seconds; no schema reversal
  or external financial dispatch.
- [Checkout concurrency](2026-09-06-local-commerce.json): eight exact retries
  return one result/order; eight competing buyers produce one order and seven
  skipped results. Zero errors. Observed p95 admission latencies were 64.62 ms
  and 86.29 ms respectively. This is local RPC contention, not hosted capacity.

Reproduction commands and safety boundaries are in the
[production runbook](../../production-runbook.md#6-backups-and-the-rehearsed-restore).

## Acceptance requiring external access or human judgment

Hosted project capacity and HTTPS configuration; repository protection;
controlled email and monitoring delivery; actual provider-connected checkout,
3DS, Connect and carrier behavior; retention/original-file policy approval;
physical-device and screen-reader acceptance; approved capacity/recovery
budgets, hosted recovery/load/observation; real invited pilot and launch approval.
Local drills do not close these gates.

## Candidate-wide follow-up

The first expanded CI candidate passed 202 browser cases and reported one
invitation-list refresh failure (two existing exclusions, zero retries).
Confirmed creation/revocation explicitly refreshes its server-rendered list.
Revocation also remains in the keyed client row after server confirmation, so
an older overlapping response cannot revert it to unclaimed.
The admin and invitation browser workflows pass together against a fresh build.
After the monotonic row correction, all three repeated invitation journeys pass
with zero retries, including persisted revocation after a full reload.
The concurrency rehearsal also removes its synthetic invitation records after
user cleanup. Its focused operations test passes. Final candidate-wide results
remain linked from PR #2 checks above.
