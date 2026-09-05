# Money follow-up — 5 September 2026

Following local commit `042f319`, provider-dispute ordering now goes through a private, service-only journal. Created/won/warning-closed order changes are atomic; old created callbacks do not reopen a terminal dispute. Exact complete baskets can book a lost dispute under a lease. Partial, conflicting, wrong-currency and oversized mappings become deduplicated, alerted recoveries rather than inferred full refunds. Expired loss leases surface in worker health.

A real local integration test simulated a crash after both orders in a lost-dispute basket were refunded but before the journal completed. Replay completed the journal, retained exactly two refund operations, and ignored the older created callback. No provider money was moved by this fixture.

Late-refund recovery closure now verifies externally completed seller recredit evidence against Stripe: exact original seller/reversal, amount, currency, mode, unreversed transfer, balance transaction, chronology and refund/adjustment metadata. Evidence is immutable and a transfer cannot satisfy multiple adjustments. Zero obligations need no seller transfer; unknown reversal outcomes require exact reconciliation. Closing or writing off the case is also blocked until an explicitly linked replacement buyer refund is fully settled in the local provider ledger.

This is evidence verification and closure protection, not automatic recovery fulfillment. The original refund reservation, replacement initiation and reversal allocation across multiple transfers still require a reviewed operator workflow. The `late_recovery` checkpoint remains in progress. See `docs/remediation-refund-recovery.md` for the exact evidence/linkage requirements and limitations.

Validation: 525 unit tests across 77 files pass; 23 SQL guard suites pass on the fresh PostgreSQL 15 schema after all 82 migrations; the dispute crash/replay integration passes; TypeScript passes and lint reports zero errors/five existing warnings. The earlier batch's 7 accessibility, 8 transaction/security browser and 10 Stripe test-mode API checks remain recorded separately; they are not being relabeled as new hosted Connect proof.

Nothing has been pushed or deployed. Hosted staging, notification destinations, manual/device evidence, policy choices and operational acceptance remain pending.
