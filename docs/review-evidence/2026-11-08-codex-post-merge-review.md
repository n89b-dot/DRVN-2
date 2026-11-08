# Codex post-merge reviews, 8 November 2026

Findings from GPT (through the Codex CLI) reviewing merged pull requests after the fact, at the rationed rate (`docs/review-evidence/codex-queue.md`). One section per finding; the first sentence states the defect. Clean reviews on the same day: #159, #166. Already fixed: #168's FAIL 7 null check (PR #180).

## #149: a hold that opens after the deletion scrub leaves the member unable to sign in

A return or chargeback can open after `scrub_deleted_account` (`supabase/migrations/20261107220510_account_deletion_scrub.sql`) has committed; the worker then lifts the ban and pauses the deletion for the member to settle, but their email and phone sign-in are already erased, so nobody can settle it. Severity P1. Ruling (8 Nov, the orchestrator under Neil's go-ahead): a scrubbed member is never reinstated; a late hold marks the case for operator attention with the reason "late hold after scrub", the account stays disabled, and the money resolves through the normal rules without the member. Fix in the OS-W34 follow-up PR.

## #149: other members' notifications keep a deleted member's name and words

The scrub removes only notifications the deleted member received; question and comment notifications sent to other members copy the author's name and the first 140 characters of what they wrote, so a comment holding a phone number survives the author's deletion. Severity P1. Fix: scrub titles and previews of notifications whose actor is the deleted member, legacy message notifications included, with a SQL guard.

## #149: a retired handle can be claimed in a race with the scrub

The username tombstone written by the scrub can be bypassed: a claim that runs while the scrub's tombstone and username clear are uncommitted sees no tombstone, waits on the uniqueness check and succeeds once the scrub commits (`supabase/migrations/20261107220500_username_rules.sql`). Severity P2. Fix: one per-handle advisory lock around retiring and claiming, with the tombstone checked after taking it.

## #149: deletions retained before the scrub existed are never scrubbed

Account deletions that were already parked as retained before #149 have completed jobs, and the worker only claims pending or expired ones, so those former traders keep their email, addresses, written text and saved cards with no retention clock. Severity P2. Fix: requeue retained-but-unscrubbed cases through the hold checks, once, as part of the follow-up migration.

## #172: older migration rows sit outside the two-day staging rule

The staging rule in `tests/ci/migrations-md.test.ts` reads only rows written in the closed vocabulary, so the 120 older rows whose "Applied to" cell is prose (for example "shared dev project (2026-11-08)") are never checked for a staging date. Severity P2, recorded only: every such row is in the frozen baseline, new rows must use the vocabulary, and staging's `--status` lists every file as applied, so nothing can slip through; only the old rows' wording is incomplete.
