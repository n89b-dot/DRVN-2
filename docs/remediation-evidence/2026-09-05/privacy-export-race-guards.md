# Privacy export race guards — 2026-09-05

Scope: local R05/R06 export pagination and export-expiry/deletion concurrency. Hosted systems and provider data were not changed.

Implemented evidence:

- Every composite-key export section now advances with a deterministic lexicographic cursor. The unit test crosses two 250-row boundaries and verifies composite cursor construction.
- Direct child sections use joined ownership/transaction filters so the export does not first materialize an arbitrary capped list of parent IDs.
- Contract v2 adds deterministic scalar/composite cursors and the approved re-credit proof projection. Its internal adjustment cursor, recovery/provider references, operator identity, and `refund_operations.replaces_adjustment_id` remain excluded. The forward migration expires unfinished v1 work with an upgrade reason while preserving completed v1 archives.
- A forward migration prevents a deletion-suspended identity from starting an export, expires every package state when deletion cleanup starts, and rejects worker checkpoints after expiry or suspension. Export requests and publication share the deletion account lock and profile eligibility lock.
- Download authorization is checked again after private Storage links are signed and immediately before the manifest response, so a deletion committed during link preparation prevents delivery.
- Export object names include their digest. If Storage accepts a write but the authoritative database checkpoint rejects it, the worker removes the unregistered object only when successful database reads prove it is unregistered and the exact lease is still current.
- Purge first marks the exact request expired and records its attempt, then inventories its complete private prefix, including uncheckpointed objects left by an interruption. `purged_at` is written only after Storage removal succeeds. Failed attempts become due again after a fifteen-minute cooldown; successful packages receive a bounded daily re-sweep for uploads that arrived after an earlier inventory. Oldest-due selection and per-request isolation prevent one failed package from starving the queue.
- Expired worker requests are purged and acknowledged as terminal instead of consuming generic export-generation retries. Storage purge failures remain durable and visible to the purge cadence.

Verification run against disposable local Postgres `127.0.0.1:54322`:

```text
npx vitest run src/lib/account-export-contract.test.ts src/lib/account-export-pagination.test.ts src/lib/account-deletion-policy.test.ts
Test Files 3 passed; Tests 7 passed

npx vitest run --config vitest.operations.config.ts tests/operations/privacy-completion.test.ts
Test Files 1 passed; Tests 2 passed
Real worker result: 501 owner car images crossed three pages, no stranger row entered the package, stranger database and private Storage access failed, completed export expired before deletion, deletion worker completed, Auth identity removed.
Compatibility result: a persisted unfinished v1 section/checkpoint was expired and its job terminally acknowledged instead of being resumed with the v2 layout.

npx vitest run --config vitest.operations.config.ts tests/operations/export.test.ts
Test Files 1 passed; Tests 1 passed
Real worker result: every declared v2 section completed; manifest was privately readable; registered and interrupted package bytes were purged without touching a newer package.
Purge result: a durable failed-attempt state respected its retry cooldown and then completed; a late orphan was removed by the periodic re-sweep while the newer package remained readable.

psql ... -f supabase/tests/account_privacy_completion_guard.sql
PASS: export reuse, checkpoint persistence, stale/expired worker denial, private access, deletion classification

psql ... -f supabase/tests/privacy_export_race_guard.sql
PASS: deletion expires active exports, stale checkpoints fail, suspended re-request fails, cross-account read fails

npm run typecheck
passed

npx eslint 'src/app/api/account/export/[id]/download/route.ts' src/lib/account-export-contract.ts src/lib/account-export-contract.test.ts src/lib/account-export-worker.ts tests/operations/privacy-completion.test.ts
passed
```

No browser suite was run because another active task owned the shared app server. No generated database type file was edited for this privacy slice.
