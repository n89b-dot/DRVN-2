# Local readiness integration — 5 September 2026

This evidence covers the next local implementation batch after `51b9cbb`. It is not hosted acceptance or a production-readiness rating.

Implemented:

- Email-bound, single-use buyer/seller invitations, an audited administration screen, signup claims and server/database commerce boundaries. Expired/revoked invitations and user-editable Auth metadata cannot grant membership. Revocation pauses new selling while retaining existing order access; sellers with existing orders can still complete payout onboarding. The migration leaves the rollout switch disabled until an operator enables it deliberately.
- Refund-reversal intent persistence, exact paginated provider reconciliation, bounded provider requests, lease-fenced completion and deduplicated recovery obligations/alerts. Uncertain history does not issue another reversal.
- A versioned account-export field inventory, both sides of messages/offers, related transaction records and private evidence; bounded resumable jobs, private hashed parts and manifest, authenticated downloads, expiry and cleanup of unregistered crash uploads. Database leases protect metadata/checkpoint publication. Pagination crosses the API row cap; enumeration beyond 100,000 related records fails visibly for operator partitioning rather than reporting a partial export as complete.
- Explicit deletion holds, cleanup and retained-identity operator outcomes; compatibility with existing jobs, stale-session protections and the existing financial guards. Legal retention/anonymization decisions remain pending.
- Worker health now detects later failures and overdue runnable work, includes export jobs and financial recovery obligations, and excludes expected future clearing/backoff. Export, deletion and expiry tasks share the tracked privacy cadence.
- An independent monitor with persisted failure/recovery/escalation identity and healthy-only dead-man heartbeats. A candidate builder/checker binds source/build/migration identities and checks actual evidence-file hashes. Neither has been deployed or used to approve a release.
- Strict WCAG A/AA checks across public and authenticated pages, keyboard/dialog checks and a pre-hydration reduced-motion rendering fix. Disabled analytics/search tests guard against provider dispatch.

Verification:

- 499 unit tests across 74 files passed on the latest full unit run. An earlier run under concurrent build load timed out in one importer test; this is retained as a diagnostic limitation, not erased by the later pass.
- 11 monitor/candidate tests passed, including transport failure, uncertain notification delivery, stale/mismatched evidence and modified evidence bytes.
- All 21 SQL guard files passed on the isolated PostgreSQL 17 DRVN database and on a fresh PostgreSQL 15 database rebuilt from all 80 migrations. Generated public database types match the fresh schema.
- TypeScript passed; lint has zero errors and five existing warnings.
- All 7 expanded accessibility browser tests passed with zero retries, including authenticated pages, keyboard signup and garage-dialog focus return.
- All 8 selected security and transaction browser tests passed with zero retries, covering stale-session deletion, CSP, pickup, shipping, partial refunds and returns.
- All 10 Stripe test-mode API integration tests passed. No live money was used. These do not substitute for hosted reversal crash-window or Connect acceptance evidence.
- The local export integration completed all declared sections, downloaded its private manifest, removed an unregistered crash upload on expiry and preserved a newer export for the same owner.
- Relational search beyond 1,000 rows, Typesense outage/rebuild and media operations passed. The combined operations run timed out in the 160-object deletion drill; the isolated deletion drill subsequently passed in about 31 seconds. The combined run is not recorded as green.

Still unfinished locally: provider-dispute ordering journal, the late-refund seller recredit/operator workflow, broader privacy/concurrency acceptance, remaining accessibility mutation/admin coverage, and final release-evidence integration. Hosted staging, external alert delivery, retention decisions, device/manual checks, approved load/recovery budgets, restore/rollback acceptance and the beta soak remain separate launch gates. The delegated agents stopped at their usage limit; their changes were integrated and tested directly.

No hosted project was changed, no existing project was paused, no paid capacity was purchased, and no changes were pushed or deployed by this batch.
