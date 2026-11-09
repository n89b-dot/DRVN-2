# Codex review queue

Every pull request merged since #61, and whether GPT (through the Codex CLI) has reviewed it after merge. Neil's rulings (7 November 2026): Codex reviews every code PR but never blocks a merge; docs-only PRs (only `docs/` or `*.md` files) are skipped; one full review per PR, then at most one fix-check of the fix alone. This file replaces the queue that lived at `~/drvn-worktrees/_plan/gpt-postmerge-queue.md` on one laptop, so the Intelligence OS and every session can see it (remediation plan A3, report three #95).

**Columns.** *Review* is one of `full`, `fix-check`, `full + fix-check`, `skipped` or `owed`. *Reviewed on* is the date of the newest review, `owed`, or `—` when skipped. *Verdict* is a one-word summary of the full review's worst finding (`clean`, `P2 found`, `P1 found`, `P0 found`). The review texts stay in the reviewing machine's `~/drvn-worktrees/_plan/reviews/` (`pr<n>.review.md`, `pr<n>.fixcheck.md`) and are not copied here: the repository is public, and a review can describe a defect before its fix lands. A finding that still needs work is filed as an Intelligence OS item, not kept here.

**Keeping it current.** Whoever merges a PR adds its row (as `owed`, or `skipped` when docs-only) in their next PR; whoever runs a review sets *Review*, *Reviewed on* and *Verdict*. `tests/ci/codex-queue.test.ts` checks every row's shape in CI. Where the full git history is present (a local checkout), it also checks that every PR merged to `main` since #61, more than two days ago, has a row. The goal is no `owed` row older than seven days.

**Owed reviews are worked down at the rationed rate,** one at a time, money, migration and auth PRs first.

| PR | Merged | Title | Review | Reviewed on | Verdict |
|---|---|---|---|---|---|
| #61 | 2026-11-07 | ops(dev): the local jobs runner calls the agent sweep every 5 minutes | owed | owed | — |
| #62 | 2026-10-24 | fix(ui): the rail's Agent row opens the side panel again | owed | owed | — |
| #63 | 2026-11-08 | OS-PR63: runbook, owner checklist and migration record match main (… | owed | owed | — |
| #64 | 2026-11-07 | OS-PR64 OS-W04: agent model boundary — hosted schedule, redacted hi… | full | 2026-11-07 | P1 found |
| #65 | 2026-11-07 | OS-PR65 OS-W01: Next 16.4.3, undici 8.12.3, zod 4.6.7 — clears the… | owed | owed | — |
| #66 | 2026-11-07 | OS-PR66 OS-W06 OS-R71 OS-R-instant OS-R-audit-killstate OS-R-agentm… | full | 2026-11-07 | P2 found |
| #68 | 2026-11-07 | docs: 3 Nov readiness review and the November blockers plan | skipped | — | docs only (ruling, 7 Nov) |
| #69 | 2026-11-07 | OS-p1-commerce: review refusal copy, email-change landing, importer… | full | 2026-11-07 | P1 found |
| #70 | 2026-11-07 | docs: Neil's rulings on the 25 decision items, checked against the… | skipped | — | docs only (ruling, 7 Nov) |
| #71 | 2026-11-07 | OS-W25: suggest rate limit, FK indexes, publication time for Newest… | full | 2026-11-07 | P2 found |
| #72 | 2026-11-07 | OS-W18: an unresolved bank chargeback freezes the seller's payout (… | full | 2026-11-07 | clean |
| #73 | 2026-11-07 | OS-W15: media integrity — canonical object identity, server-only st… | full | 2026-11-07 | P2 found |
| #74 | 2026-11-07 | OS-W26 OS-R-overclaim: qualify car-provenance claims, post sitemaps… | full | 2026-11-07 | P2 found |
| #75 | 2026-11-07 | ci(e2e): keep the settling offer move's result note so the accept r… | full | 2026-11-07 | P0 found |
| #76 | 2026-11-07 | fix(lint): env test unused binding fails CI's zero-warning lint | full | 2026-11-07 | clean |
| #77 | 2026-11-07 | OS-W22: social retrieval at scale — complete counts, joined feeds,… | full | 2026-11-07 | P2 found |
| #78 | 2026-11-07 | OS-PR33 OS-W02: CI start retry kills the whole process tree and bou… | full | 2026-11-07 | P2 found |
| #79 | 2026-11-07 | OS-PR64 OS-W04: settlement takes the reservation lock, unknown spen… | full | 2026-11-07 | P1 found |
| #80 | 2026-11-07 | OS-W09 OS-R-cron: constant-time job auth, one job inventory, health… | full | 2026-11-07 | P2 found |
| #81 | 2026-11-07 | OS-W27: keep nested errors in monitoring reports; admit Stripe.js f… | full | 2026-11-07 | P0 found |
| #82 | 2026-11-07 | OS-W19 OS-W30 OS-R-audit-dispatch: locked pickup mint, seller-first… | full + fix-check | 2026-11-07 | P1 found; fix-check done |
| #83 | 2026-11-07 | OS-W24 OS-R-h5 OS-R-e1: Home fold after post eight, fixed Explore c… | full | 2026-11-07 | clean |
| #84 | 2026-11-07 | OS-W35: saved-search email digests, at most one per search per day… | full | 2026-11-07 | P2 found |
| #85 | 2026-11-07 | docs(staging): R-staging done — staging project, rulings, keeping i… | skipped | — | docs only (ruling, 7 Nov) |
| #86 | 2026-11-07 | OS-W12 OS-W13: sign-in security, sign-in messages and auth layout (… | full | 2026-11-07 | P1 found |
| #87 | 2026-11-07 | OS-W14 OS-R-audit-closecase: admin reads gated, exports complete, r… | full | 2026-11-07 | P1 found |
| #88 | 2026-11-07 | ci: let runs on main finish; keep cancelling superseded runs on pul… | owed | owed | — |
| #89 | 2026-11-07 | OS-W16 OS-R-audit-sell: listing write boundary held in the database… | full | 2026-11-07 | P1 found |
| #90 | 2026-11-07 | docs(plans): R-hold ruled, every fallback becomes 2 days | skipped | — | docs only (ruling, 7 Nov) |
| #91 | 2026-11-07 | OS-W20: settlement correctness and daily ledger reconciliation (N8… | full | 2026-11-07 | P2 found |
| #92 | 2026-11-08 | OS-W10: migration runner needs a dry run, an allow-listed target an… | full | 2026-11-07 | P1 found |
| #93 | 2026-11-08 | N425 N539 N422 N476 N477 N519: payout-hold docs, Stripe API pin, pr… | full | 2026-11-07 | P2 found |
| #94 | 2026-11-08 | OS-W07 OS-R73 OS-R-audit: agent tool contracts, safe build links, a… | full + fix-check | 2026-11-07 | P1 found; fix-check done |
| #95 | 2026-11-08 | OS-W21 N247 N53 N62 N140: social abuse and moderation — database wr… | full | 2026-11-07 | P1 found |
| #96 | 2026-11-08 | OS-W05: approvals record accepted only when the offer move accepts;… | full | 2026-11-07 | clean |
| #97 | 2026-11-07 | Readiness crosswalk: the OS's 88 N4xx/R items mapped to plan ids, P… | skipped | — | docs only (ruling, 7 Nov) |
| #98 | 2026-11-08 | N420 N421 N444 N445 N446 N447 N448 N453: proof — sign-in and accoun… | skipped | — | docs only (ruling, 7 Nov) |
| #99 | 2026-11-08 | N434 N435 N454 N458 N459 N460 N461 N462 N464: proof — social items… | skipped | — | docs only (ruling, 7 Nov) |
| #100 | 2026-11-08 | N433 N469 N470 N472 N475: proof — listings and discovery items fixe… | skipped | — | docs only (ruling, 7 Nov) |
| #101 | 2026-11-08 | N415 N416 N488 N489 N491 N493 N497 N502: proof — commerce and money… | skipped | — | docs only (ruling, 7 Nov) |
| #102 | 2026-11-08 | OS-R-usage OS-R-measures OS-R-w3 R-usage R-measures R-w3: typed age… | full | 2026-11-07 | clean |
| #103 | 2026-11-08 | N410 N414 N529 N530 N532 N534 N537: proof — admin, ops and CI items… | owed | owed | — |
| #104 | 2026-11-07 | N514 N521: proof — agent turn deadline and suspended members, fixed… | skipped | — | docs only (ruling, 7 Nov) |
| #105 | 2026-11-08 | OS-W23 OS-R-untested N65 N66 N67 N248: garage integrity — versioned… | full | 2026-11-07 | P1 found |
| #106 | 2026-11-08 | R-hold: the payout hold's fallbacks become 2 days | owed | owed | — |
| #107 | 2026-11-08 | OS-W20: ledger reconciliation and refund gap follow-ups | fix-check | 2026-11-07 | fix-check of an earlier PR's findings |
| #108 | 2026-11-08 | OS-W29 OS-R-disputecats: eBay-style dispute recourse, final resolut… | full + fix-check | 2026-11-07 | P1 found; fix-check done |
| #109 | 2026-11-08 | OS-W28 OS-R-arrival: measurement contracts — a counted listing view… | full | 2026-11-07 | clean |
| #110 | 2026-11-08 | OS-W14: admin privilege binds to the confirmed factor; paged actor… | fix-check | 2026-11-07 | fix-check of an earlier PR's findings |
| #111 | 2026-11-08 | OS-W17 OS-R-audit-buybar N85 N86 N87 N88 N90: checkout resume, rest… | full | 2026-11-07 | P2 found |
| #112 | 2026-11-08 | OS-W12: deletion and password change enforce fresh proof at the dat… | fix-check | 2026-11-07 | fix-check of an earlier PR's findings |
| #113 | 2026-11-08 | OS-W16: payout readiness before any new payment; content freeze on… | fix-check | 2026-11-07 | fix-check of an earlier PR's findings |
| #114 | 2026-11-08 | fix(agent): keep "Stopped." when the offer page comes back with the… | full | 2026-11-07 | clean |
| #115 | 2026-11-08 | OS-W35: digest windows survive in-flight publications, drain fully,… | fix-check | 2026-11-07 | fix-check of an earlier PR's findings |
| #116 | 2026-11-08 | OS-W08 OS-R81 OS-R-photos: private agent chat photos, and image byt… | full | 2026-11-07 | P1 found |
| #117 | 2026-11-08 | R69-age R69-dmca N629 R-audit-composer: 18+ confirmation, copyright… | full | 2026-11-07 | P2 found |
| #118 | 2026-11-08 | OS-R-untested R-untested: behaviour tests for the 13 untested P0 re… | owed | owed | — |
| #119 | 2026-11-08 | OS-W11 N35 N39 N47: account privacy lifecycle — suspended members k… | full | 2026-11-07 | P2 found |
| #120 | 2026-11-08 | OS-W10: migration runner review follow-ups (transaction control lex… | fix-check | 2026-11-07 | fix-check of an earlier PR's findings |
| #121 | 2026-11-08 | OS-W32 N54 N59 R-directcontact: private blocks, suspended members h… | full | 2026-11-07 | P1 found |
| #122 | 2026-11-08 | OS-W33 N77: withdraw listings with offers instead of deleting them | full | 2026-11-07 | P1 found |
| #123 | 2026-11-08 | N244: eBay-style payout setup — started to sell, enabled to be paid… | full | 2026-11-07 | P1 found |
| #124 | 2026-11-08 | OS-R-untested R-untested: A-4 also checks the fitment year comes fr… | owed | owed | — |
| #125 | 2026-11-08 | fix(agent): /agent keeps the Stopped confirmation after a stop | full | 2026-11-07 | clean |
| #126 | 2026-11-08 | OS-W31 N89 beta: remove the invite-only beta, cap guest holds, prov… | full | 2026-11-07 | P1 found |
| #127 | 2026-11-08 | OS-W08: chat photo copies tracked per bucket, copies reused, legacy… | fix-check | 2026-11-07 | fix-check of an earlier PR's findings |
| #128 | 2026-11-08 | OS-W32: system offer moves bypass blocks; forged events can't skip… | fix-check | 2026-11-07 | fix-check of an earlier PR's findings |
| #129 | 2026-11-08 | fix(styles): smooth scrolling honours reduced motion, so a WebKit c… | full | 2026-11-07 | P2 found |
| #130 | 2026-11-08 | OS-R-untested R-untested: G-5 keeps came-off parts whose listing is… | owed | owed | — |
| #131 | 2026-11-08 | N244: record the dispatched-order case as set aside (docs only) | skipped | — | docs only (ruling, 7 Nov) |
| #132 | 2026-11-08 | OS-W33: withdrawal can't undo moderation, buyers keep offer history… | fix-check | 2026-11-07 | fix-check of an earlier PR's findings |
| #133 | 2026-11-08 | OS-W23: every build-sheet write takes the sheet lock; unlink is ato… | fix-check | 2026-11-07 | fix-check of an earlier PR's findings |
| #134 | 2026-11-08 | N244: payout deadline fences, fair retries, complete refunds and sa… | fix-check | 2026-11-07 | fix-check of an earlier PR's findings |
| #135 | 2026-11-08 | OS-W31 beta follow-up: fix main's sql-guard (payout guard still swi… | owed | owed | — |
| #136 | 2026-11-08 | test(sql): payout-setup guard drops its stale beta-gate update (mai… | owed | owed | — |
| #137 | 2026-11-08 | docs(readiness): 7 Nov whole-codebase production-readiness review | skipped | — | docs only (ruling, 7 Nov) |
| #138 | 2026-11-08 | OS-signals: Resolves enforcement, docs/ids.md, crosswalk as JSON | owed | owed | — |
| #139 | 2026-11-08 | R69-age R69-dmca N629: record the three launch-legal migrations in… | skipped | — | docs only (ruling, 7 Nov) |
| #140 | 2026-11-08 | OS-signals: JUnit from every test lane | owed | owed | — |
| #141 | 2026-11-08 | OS-W17: guest DRVN checkout resumes, Finish checkout works across d… | fix-check | 2026-11-07 | fix-check of an earlier PR's findings |
| #142 | 2026-11-08 | OS-signals: finding id in the test names a PR touches | owed | owed | — |
| #143 | 2026-11-08 | OS-signals: migration status as JSON, MIGRATIONS.md ratchet | owed | owed | — |
| #144 | 2026-11-08 | OS-R-untested R-untested: M-4 keeps two cards across at 320px | owed | owed | — |
| #145 | 2026-11-08 | OS-signals: /api/version and a per-commit release-gate record | owed | owed | — |
| #146 | 2026-11-08 | OS-signals: migration rows record who, which commit and which PR | owed | owed | — |
| #147 | 2026-11-08 | OS-R-migrations: a verified record-only mode for the migration runner | full | 2026-11-07 | P1 found |
| #148 | 2026-11-08 | N531 N627 N232: audited admin exports, old message photo metadata s… | full + fix-check | 2026-11-08 | P1 found; fix-check done |
| #149 | 2026-11-08 | OS-W34 N16 N38: deletion scrubs personal data on a 6-year key clock… | full | 2026-11-08 | P1 found (2 P1, 2 P2: N690–N693, fixed in #181) |
| #150 | 2026-11-08 | R69-dmca: blocked-media cache ages from the caller's clock (fixes a… | owed | owed | — |
| #151 | 2026-11-08 | OS-R-migrations: record-only refuses dynamic SQL it can't parse, ke… | fix-check | 2026-11-07 | fix-check of an earlier PR's findings |
| #152 | 2026-11-08 | Checkout: resume never adds unrelated cart items; guest hold admiss… | fix-check | 2026-11-07 | fix-check of an earlier PR's findings |
| #153 | 2026-11-08 | OS-W11: deletion status is reachable; the admin queue pages past 50 | fix-check | 2026-11-08 | fix-check of an earlier PR's findings |
| #154 | 2026-11-08 | OS-W21: a hold always hides the build, evidence cap is atomic, list… | fix-check | 2026-11-08 | fix-check of an earlier PR's findings |
| #155 | 2026-11-08 | Tests: the reduced-motion scroll guard catches comma media queries | owed | owed | — |
| #156 | 2026-11-08 | Disputes: the 8-photo evidence limit holds under concurrent attaches | full | 2026-11-08 | clean |
| #157 | 2026-11-08 | OS-W11: account deletion checks financial holds before banning sign-in | full + fix-check | 2026-11-08 | P1 found; fix-check done |
| #158 | 2026-11-08 | Agent: card-number redaction never corrupts ids | full | 2026-11-08 | P2 found |
| #159 | 2026-11-08 | Agent: emails containing ids are still redacted for the model | full | 2026-11-08 | clean |
| #161 | 2026-11-08 | docs(migrations): record 20261108130400 as applied to shared dev | skipped | — | docs only (ruling, 7 Nov) |
| #162 | 2026-11-08 | OS-signals: staging caught up to main; shared dev history gaps reco… | full | 2026-11-08 | clean |
| #163 | 2026-11-08 | docs(plans): remediation plan from the 7 Nov readiness report | skipped | — | docs only (ruling, 7 Nov) |
| #164 | 2026-11-08 | OS-W11: an open bank chargeback holds account deletion | full | 2026-11-08 | P1 found |
| #165 | 2026-11-08 | docs: mark 20261108140000 applied to shared dev (#164) | skipped | — | docs only (ruling, 7 Nov) |
| #166 | 2026-11-08 | OS-W11: chargeback hold guard proves the seller is held by the char… | full | 2026-11-08 | clean |
| #167 | 2026-11-08 | docs: remediation record, staging catch-up cells, shared dev's 12 h… | skipped | — | docs only (ruling, 7 Nov) |
| #169 | 2026-11-08 | test(ci): migrations are added in date order and never renamed (#97) | owed | owed | — |
| #168 | 2026-11-08 | OS-W36 N677 N680: approval guard fails deterministically; job inventory … | full | 2026-11-08 | P2 found (FAIL 7 null-safe; fixed in the next PR) |
| #170 | 2026-11-08 | test(ci): the crosswalk cites only files that exist; advisory floors … | owed | owed | — |
| #171 | 2026-11-08 | docs: the Codex review queue moves into the repository (#95) | owed | owed | — |
| #172 | 2026-11-08 | OS-W37 R-rcconfig R-staging-behind: guest hold caps is the 15th release … | full | 2026-11-08 | P2 found (N694, recorded only) |
| #173 | 2026-11-08 | OS-W38 N540: the sandbox payment override can never be on a hosted deployment | owed | owed | — |
| #174 | 2026-11-08 | OS-W38 N686: members from before the 18+ confirmation confirm it once at their next sign-in | owed | owed | — |
| #175 | 2026-11-08 | OS-W39 N634 N528 N224: deploy pipeline gated on release-gate and migrations; infrastructure… | owed | owed | — |
| #176 | 2026-11-08 | N499: crash recovery finds an orphaned transfer past the newest 1,000, and never re-issues… | owed | owed | — |
| #178 | 2026-11-08 | OS-W38 N455: member photos are private objects, shown through signed URLs | owed | owed | — |
| #179 | 2026-11-08 | docs: remediation record brought current; branch protection requires up-to-date… | skipped | — | docs only (ruling, 7 Nov) |
| #180 | 2026-11-08 | OS-W36 N677: FAIL 7 is null-safe and FAIL 0 always includes a mangled id (Codex review… | owed | owed | — |
| #181 | 2026-11-08 | OS-W34 N418: late holds after the scrub, notification previews, handle lock, old retained… | owed | owed | — |
