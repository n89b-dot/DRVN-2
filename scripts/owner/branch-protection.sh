#!/usr/bin/env bash
# Protects `main` on GitHub: pull requests required, the `release-gate` CI
# check required, force pushes and deletion blocked.
#
# Works only once the repository is public or the account has GitHub Pro.
# On a private repo on GitHub Free, GitHub answers 403 "Upgrade to GitHub Pro
# or make this repository public".
#
# Usage:
#   scripts/owner/branch-protection.sh             dry run: prints the commands
#   scripts/owner/branch-protection.sh --apply     runs them (needs `gh auth login` as a repo admin)
#   scripts/owner/branch-protection.sh --verify    read-only checks of what is in force
#   scripts/owner/branch-protection.sh --classic   use classic branch protection instead of a ruleset
#   REPO=owner/name scripts/owner/branch-protection.sh ...   (default: n89b-dot/DRVN-2)
#
# Details and the reasoning: docs/owner/branch-protection.md
set -euo pipefail

REPO="${REPO:-n89b-dot/DRVN-2}"
BRANCH="main"
RULESET_NAME="protect-main"
CHECK="release-gate"
# GitHub Actions' app id. Pinning the check to it means only a workflow run
# can satisfy `release-gate`, not a commit status posted by some other token.
ACTIONS_APP_ID=15368

MODE="dry-run"
STYLE="ruleset"
for arg in "$@"; do
  case "$arg" in
    --apply) MODE="apply" ;;
    --verify) MODE="verify" ;;
    --classic) STYLE="classic" ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if ! [[ "$REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
  echo "REPO must look like owner/name" >&2; exit 2
fi

RULESET_JSON=$(cat <<JSON
{
  "name": "$RULESET_NAME",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [ { "context": "$CHECK", "integration_id": $ACTIONS_APP_ID } ] } }
  ]
}
JSON
)

CLASSIC_JSON=$(cat <<JSON
{
  "required_status_checks": { "strict": false, "checks": [ { "context": "$CHECK", "app_id": $ACTIONS_APP_ID } ] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0, "dismiss_stale_reviews": false, "require_code_owner_reviews": false },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false
}
JSON
)

need_gh() {
  command -v gh >/dev/null || { echo "Install the GitHub CLI (https://cli.github.com) and run: gh auth login" >&2; exit 1; }
}

existing_ruleset_id() {
  gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$RULESET_NAME\") | .id" | head -n1
}

verify() {
  need_gh
  echo "== Repository visibility and plan"
  gh api "repos/$REPO" --jq '"visibility: \(.visibility)  default branch: \(.default_branch)"'
  echo "== Rules in force on $BRANCH (rulesets and classic protection combined)"
  gh api "repos/$REPO/rules/branches/$BRANCH" --jq '.[] | "\(.type)\(if .parameters.required_status_checks then ": " + ([.parameters.required_status_checks[].context] | join(",")) else "" end)  [\(.ruleset_source_type // "") \(.ruleset_id // "")]"'
  echo "== Rulesets"
  gh api "repos/$REPO/rulesets" --jq '.[] | "\(.id)  \(.name)  \(.enforcement)"'
  echo "== Classic protection (404 = none, which is fine when the ruleset is used)"
  gh api "repos/$REPO/branches/$BRANCH/protection" --jq '{checks: [.required_status_checks.checks[]?.context], force_push: .allow_force_pushes.enabled, deletion: .allow_deletions.enabled, admins: .enforce_admins.enabled}' 2>&1 || true
  echo
  echo "Expect: deletion, non_fast_forward, pull_request and required_status_checks: $CHECK."
  echo "Then prove it: 'git push --force-with-lease origin HEAD:$BRANCH' from a throwaway commit must be refused,"
  echo "and a PR whose CI is red must show 'Required: $CHECK' and no enabled merge button."
}

if [[ "$MODE" == "verify" ]]; then verify; exit 0; fi

if [[ "$STYLE" == "ruleset" ]]; then
  if [[ "$MODE" == "dry-run" ]]; then
    echo "# Dry run. These are the commands --apply runs for $REPO."
    echo "# If a ruleset named $RULESET_NAME already exists, --apply updates it (PUT) instead of creating a second one."
    echo "gh api -X POST repos/$REPO/rulesets --input - <<'JSON'"
    echo "$RULESET_JSON"
    echo "JSON"
    echo "# or, to update: gh api -X PUT repos/$REPO/rulesets/<id> --input - (same body)"
    echo "# Verify afterwards: $0 --verify"
    exit 0
  fi
  need_gh
  id="$(existing_ruleset_id || true)"
  if [[ -n "$id" ]]; then
    echo "Updating ruleset $RULESET_NAME ($id) on $REPO"
    printf '%s' "$RULESET_JSON" | gh api -X PUT "repos/$REPO/rulesets/$id" --input - --jq '"ruleset \(.id) \(.name): \(.enforcement)"'
  else
    echo "Creating ruleset $RULESET_NAME on $REPO"
    printf '%s' "$RULESET_JSON" | gh api -X POST "repos/$REPO/rulesets" --input - --jq '"ruleset \(.id) \(.name): \(.enforcement)"'
  fi
else
  if [[ "$MODE" == "dry-run" ]]; then
    echo "# Dry run (classic branch protection). --apply runs:"
    echo "gh api -X PUT repos/$REPO/branches/$BRANCH/protection --input - <<'JSON'"
    echo "$CLASSIC_JSON"
    echo "JSON"
    echo "# Verify afterwards: $0 --verify"
    exit 0
  fi
  need_gh
  echo "Applying classic branch protection to $REPO:$BRANCH"
  printf '%s' "$CLASSIC_JSON" | gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" --input - --jq '"protected: \(.url)"'
fi

echo
verify
