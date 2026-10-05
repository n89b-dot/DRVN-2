# Protecting `main`

Goal: nothing reaches `main` without a pull request whose CI passed. The
check that matters is `release-gate` (`.github/workflows/ci.yml`). It is the
aggregate job: it fails unless `verify`, `secrets`, `secrets-full`,
`sql-guard`, `e2e` and `stripe-integration` all ran and passed.

Script: `scripts/owner/branch-protection.sh`. Background: runbook §8
(`docs/production-runbook.md`).

## Before you start [OWNER]

1. **Plan.** The repository `n89b-dot/DRVN-2` is private on GitHub Free,
   where rulesets and branch protection are unavailable (GitHub answers
   `403 Upgrade to GitHub Pro or make this repository public`). Upgrade the
   account to GitHub Pro, or make the repository public. About 5 minutes.
2. **Stripe test key for CI.** Settings → Secrets and variables → Actions →
   new repository secret `STRIPE_TEST_SECRET_KEY` = a Stripe **test-mode**
   secret key (`sk_test_…`). Without it `stripe-integration` fails on purpose
   and `release-gate` can never pass, so every PR would be blocked.
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
`required_status_checks: release-gate`.

Then prove it:

1. From a throwaway local commit on `main`, `git push origin HEAD:main` →
   refused ("Changes must be made through a pull request").
2. `git push --force origin HEAD:main` → refused.
3. Open a PR, and before CI finishes, look at the merge box: "Required:
   release-gate" is listed and merging is blocked.
4. Keep the `--verify` output and a screenshot of step 3 with the release
   packet. None of the 15 gates checks branch protection, so this is the
   only record of it.

## The deploy boundary [OWNER]

A protected branch doesn't stop the host from deploying an unchecked commit.
If Vercel deploys production from `main`, that is fine once `main` only moves
through PRs. If you ever deploy from another branch or by hand, require the
`release-gate` check first (Vercel → Project → Settings → Git, or deployment
protection), or only promote builds whose commit shows a green
`release-gate`.
