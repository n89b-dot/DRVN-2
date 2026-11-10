# Protecting `main`

Goal: nothing reaches `main` without a pull request whose CI passed. The
check that matters is `release-gate` (`.github/workflows/ci.yml`). It is the
aggregate job: it fails unless `verify`, `secrets`, `secrets-full`,
`sql-guard`, `e2e`, `e2e-launch` and `stripe-integration` all ran and passed.
(`e2e-launch` is the launch-configuration browser lane, plan 2 item A4; it
needs the Actions variable `STRIPE_TEST_PUBLISHABLE_KEY` beside the secret in
step 2 below.) There is one
exception, described under "Documents-only pull requests" below. The browser
suite runs as four parts side by side (`e2e-parts`, shown as "e2e part 1" to
"e2e part 4"); the job named `e2e` judges them, and the gate requires both the
parts' own result and that judgement (plan 2 item A0b, `e2e/README.md`).

Script: `scripts/owner/branch-protection.sh`. Background: runbook §8
(`docs/production-runbook.md`).

## Before you start [OWNER]

1. **Plan.** The repository `n89b-dot/DRVN-2` is private on GitHub Free,
   where rulesets and branch protection are unavailable (GitHub answers
   `403 Upgrade to GitHub Pro or make this repository public`). Upgrade the
   account to GitHub Pro, or make the repository public. About 5 minutes.
2. **Stripe test keys for CI.** These are the keys of the Stripe sandbox kept
   for CI alone (Stripe dashboard: account picker → Sandboxes; one sandbox per
   deployment, `docs/staging-setup.md` §5 says why), so that check runs' test
   payments reach no other deployment. Settings → Secrets and variables →
   Actions → new repository secret `STRIPE_TEST_SECRET_KEY` = that sandbox's
   secret key (`sk_test_…`). Without it `stripe-integration` fails on purpose
   and `release-gate` can never pass, so every PR would be blocked. On the
   Variables tab of the same page, new repository variable
   `STRIPE_TEST_PUBLISHABLE_KEY` = the publishable key (`pk_test_…`) of the
   same sandbox. It is not a secret (it ships in
   every page of the site). Without it `e2e-launch` fails on purpose, naming
   the variable.
3. **GitHub CLI.** `gh auth login` as an account with admin rights on the
   repository.
4. Make sure `release-gate` has run at least once on a PR (it has). GitHub
   only offers checks it has seen.

## Apply [OWNER]

```bash
scripts/owner/branch-protection.sh            # dry run: prints the exact gh api call and JSON
scripts/owner/branch-protection.sh --apply    # creates or updates the ruleset "protect-main"
```

The ruleset targets the default branch and has four rules:

| Rule | Effect |
|---|---|
| `pull_request` (0 approvals) | Changes go through a PR. No approval is required: this is a solo-maintained repo, and the point is routing changes through CI |
| `required_status_checks`: `release-gate`, pinned to GitHub Actions (app id 15368) | The PR can't merge until the check passes. Pinning means only a workflow run satisfies it, not a status posted by another token |
| `non_fast_forward` | Force pushes are blocked |
| `deletion` | The branch can't be deleted |

`bypass_actors` is empty, so the rules also bind admins. If you want an
emergency door, add yourself as a bypass actor in the UI (Settings → Rules →
Rulesets → protect-main → Bypass list, "for pull requests only") and write
down when you use it.

**Watched (#112).** `.github/workflows/protection-watch.yml` runs
`scripts/check-branch-protection.mjs` on every push to `main`, hourly and by
hand. It fails, and GitHub emails the failure, when `main` has lost the pull
request rule, `release-gate` (pinned to GitHub Actions, on an up-to-date
branch), the force-push block or the deletion block. Re-apply with
`--apply` below. Run it yourself any time:
`node scripts/check-branch-protection.mjs`.

**What the watch checks beyond the rules (work review #156, #139).** Reading
the rules only shows the present: protection that was removed, used and put
back within the hour would look fine. So each run also asks how the commit
now at `main`'s head got there. It must be a merge commit whose second
parent, the pull request's head, passed `release-gate` and was level with
`main` when it merged; a commit pushed straight to `main`, or merged before
its checks finished, fails the run. It also checks the `production`
deployment environment once that exists: it must have required reviewers and
a restriction on which branches and tags may deploy. And the production
deploy itself starts with a job that names no environment and refuses to go
on unless `production` exists and is guarded, because a job that names a
missing environment makes GitHub create it unprotected. A failed watch posts
to the alert channel (`ADMIN_ALERT_WEBHOOK_URL`), not only GitHub's own
email. Run it by hand with `node scripts/check-branch-protection.mjs`, or
`node scripts/check-branch-protection.mjs --environment production`.

Re-running `--apply` updates the existing ruleset (found by name) instead of
creating a second one.

The runbook's older JSON (§8) left out `non_fast_forward` and `deletion`.
Rulesets made in the UI tick those boxes by default; rulesets made through the
API don't. The script includes them.

### Classic branch protection instead

If you prefer classic protection (Settings → Branches), the same intent is:

```bash
scripts/owner/branch-protection.sh --classic           # dry run
scripts/owner/branch-protection.sh --classic --apply
```

Use one or the other, not both. Rulesets are the newer mechanism and are what
the runbook assumes.

## Verify [OWNER, 5 minutes]

```bash
scripts/owner/branch-protection.sh --verify
```

It prints the repository visibility, the rules in force on `main`
(`GET /repos/{repo}/rules/branches/main`), the rulesets, and any classic
protection. Expect `deletion`, `non_fast_forward`, `pull_request` and
`required_status_checks: release-gate`, with strict status checks on (see
below).

Then prove it:

1. From a throwaway local commit on `main`, `git push origin HEAD:main` →
   refused ("Changes must be made through a pull request").
2. `git push --force origin HEAD:main` → refused.
3. Open a PR, and before CI finishes, look at the merge box: "Required:
   release-gate" is listed and merging is blocked.
4. Keep the `--verify` output and a screenshot of step 3 with the release
   packet. None of the 15 gates checks branch protection, so this is the
   only record of it.

## Branches must be up to date (strict status checks)

The ruleset requires a pull request's branch to contain current `main` before
`release-gate` counts (`strict_required_status_checks_policy: true`; classic
protection: `required_status_checks.strict: true`). Every PR is then tested
against the rules it will land on. Twice on 7–8 November 2026 a PR that was
green against an older `main` merged after another PR changed the rules it was
tested under, and `main` went red (remediation plan A2). A PR that falls
behind shows "This branch is out-of-date"; update it (`gh pr update-branch <n>`
or merge `main` into it) and let its checks rerun before merging.

## Documents-only pull requests

Since plan 2 item A0 (November 2026), a pull request whose every changed file
is a document skips the two browser jobs, `e2e` and `e2e-launch`, and (since
plan 2 finding F1) the Stripe test-mode job `stripe-integration`, and
`release-gate` accepts those skips. A change to documents cannot affect
Stripe, and each run of that job creates 49 test events on the CI sandbox. It
still runs and must pass `verify`, both secret scans and `sql-guard`, so such
a pull request is mergeable in about five minutes, not twenty to forty-five.

- **What counts as a document:** any `.md` file, and files under `docs/` that
  are text, data or images (`md`, `txt`, `log`, `json`, `jsonl`, `csv`, `html`,
  `pdf`, `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`). Nothing under
  `.github/workflows/` counts, and a script kept under `docs/` does not count.
  The list is `scripts/ci-change-scope.mjs`.
- **Only pull requests into `main`.** A pull request based on another branch
  always gets the full suite. A check's result belongs to the head commit, and
  GitHub does not rerun CI when a pull request's base is changed, so a
  documents-only answer worked out against another branch would still stand
  after the pull request was moved onto `main`, carrying that branch's code in
  with it.
- **What decides it:** the `changes` job, from the diff between the pull
  request's merge commit and its base. A moved file is read as a deletion plus
  an addition, so moving code into `docs/` is still a code change.
- **What the gate accepts:** a skipped `e2e` and a skipped `e2e-launch` only
  when the event is a pull request, the `changes` job succeeded, and it
  answered documents-only. A skipped, failed or cancelled browser job in any
  other case keeps the gate red, as does a failed `changes` job.
- **`main` is unchanged:** a push to `main` and a manual run always run the
  whole suite. Every commit on `main` is still proven by the browser tests, and
  the deploy workflow reads that run.
- **Proof:** `tests/ci/change-scope.test.ts` runs the classifier and the gate's
  own script for both directions. The gate's per-commit record
  (`release-gate-<sha>.json`) carries `scope: "documents-only"` or `"full"`.

The required check is still `release-gate` alone, and it always reports a
result, so nothing in the ruleset changes.

## History

- **8 November 2026, about 18:50 UTC:** `main` was found with no ruleset and no
  classic protection (`GET /repos/{repo}/branches/main/protection` answered 404,
  rulesets `[]`). Nothing in any session's record showed a deliberate removal.
  PRs armed with `gh pr merge --auto` merged before their checks finished. The
  orchestrating session restored the `protect-main` ruleset from this script
  (release-gate required, pull requests required, force pushes and deletion
  blocked), ruleset id `26808907`.
- **8 November 2026:** strict status checks ("require branches to be up to
  date") turned on at Neil's go-ahead (plan A2), and this script now sets it.

## The deploy boundary [OWNER]

A protected branch doesn't stop the host from deploying an unchecked commit.
If Vercel deploys production from `main`, that is fine once `main` only moves
through PRs. If you ever deploy from another branch or by hand, require the
`release-gate` check first (Vercel → Project → Settings → Git, or deployment
protection), or only promote builds whose commit shows a green
`release-gate`.
