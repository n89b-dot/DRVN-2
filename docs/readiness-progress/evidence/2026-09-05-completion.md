# Final local remediation follow-up — 2026-09-05

The controlled beta remains unreleased. These changes extend merged source `5f92115` on `codex/complete-beta-readiness`.

## What changed

- Late-refund recovery has an explicit, audited replacement action. It verifies seller repayment, atomically exchanges the failed reservation for a linked replacement, rechecks allocation at the provider boundary, and reverses the dedicated repayment transfer. Retries, early failures, repeated late failures, external callbacks and closure obligations have database regressions. Unknown or changed allocations remain operator cases; creating seller recredits remains an approved operational step.
- Export contract v2 uses stable cursors, narrower ownership queries and explicit safe fields. Incompatible unfinished v1 exports expire rather than resume at shifted section positions. Completed v1 archives retain normal expiry. Deletion fences package publication/download, and consumed invitation history survives account deletion.
- Accessibility coverage now includes authenticated checkout, 320px reflow, announced authentication errors and MFA-authenticated admin pages. The admin zero-queue explanatory text had a real contrast failure and was corrected. A 32-journey inventory records the remaining mutation/device acceptance gaps.
- A loopback-only load harness records public-route latency, errors and throughput. It cannot target hosted services.

## Evidence and limits

- Unit checks: 530 tests in 78 files passed at this follow-up; final suite results are recorded in the task and PR.
- Fresh Postgres: all 85 migrations applied; schema generation matched. All 25 SQL guard suites passed after the new privacy test’s missing runner success marker was corrected.
- Privacy operations: three actual local tests passed, covering a 501-row export, cross-account denial, deletion, incompatible-contract expiry, failed purge replay, newer-package isolation and late-orphan resweep.
- Accessibility/admin: nine selected Chromium cases passed in one zero-retry run (2.4 minutes). After the CI contrast/export corrections, all 10 cases in the accessibility and export files passed in a separate zero-retry run (1.4 minutes). Earlier startup timeouts and a corrected test-anchor failure are excluded from final pass counts.
- Local public reads: 1,946 requests over three 15-second stages at concurrency 1, 5 and 20; zero HTTP errors. At concurrency 20 the highest route p95 was 1,508ms. The machine also hosted development services; this is not a production capacity estimate or accepted latency budget.
- The previous merged GitHub run failed on an ECR image-pull rate limit, a populated-state accent-text contrast issue and an obsolete synchronous-export browser expectation. This batch addresses those failures; a fresh CI result must be observed rather than inferred from local tests.

## Still required for release

The selected Supabase organization still has DRVN and Distill occupying its two active slots. No unrelated project was paused and no paid upgrade was purchased. Hosted HTTPS/Connect/3DS, controlled external email and alerts, approved retention and original-file removal, physical-device/screen-reader acceptance, coordinated hosted restore/rollback, agreed capacity targets, observation period and an invited pilot remain release requirements. Optional analytics and external search remain disabled for beta acceptance until their provider gates pass.

The schema-generator registry workaround follows the observed CI error and the upstream [Supabase CLI registry issue](https://github.com/supabase/cli/issues/5785). The official GHCR v0.98.0 Linux/amd64 manifest was inspected and pinned; the generated schema comparison remains mandatory.
