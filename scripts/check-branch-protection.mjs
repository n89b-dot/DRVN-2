#!/usr/bin/env node
// Fails loudly when `main` is no longer protected the way docs/owner/
// branch-protection.md sets it up (report five #112). On 8 November 2026
// `main` had no ruleset for nine minutes and six pull requests merged before
// their checks finished; nothing noticed.
//
// Reads GitHub's "rules for a branch" endpoint, which lists every rule in
// force on `main` from any ruleset, and is readable without a token on a
// public repository (GITHUB_TOKEN is used when present, for rate limits).
//
//   node scripts/check-branch-protection.mjs [owner/repo] [branch]
import { fileURLToPath } from 'node:url';

/** GitHub Actions' app id: a required check pinned to it can only be met by a workflow run. */
export const GITHUB_ACTIONS_APP_ID = 15368;

/**
 * What is missing from the rules in force on the branch, in words. Empty
 * means protected as documented: changes through a pull request,
 * `release-gate` required from GitHub Actions on a branch level with the
 * base, no force pushes, no deletion.
 *
 * @param {any} rules the body of GET /repos/{repo}/rules/branches/{branch}
 * @returns {string[]}
 */
export function protectionProblems(rules) {
  if (!Array.isArray(rules)) return ['GitHub did not return a list of rules for the branch'];
  const byType = new Map();
  for (const rule of rules) byType.set(rule?.type, [...(byType.get(rule?.type) ?? []), rule]);
  const problems = [];
  if (!byType.has('pull_request')) problems.push('no pull_request rule: changes can be pushed to the branch directly');
  const checks = (byType.get('required_status_checks') ?? []).map((rule) => rule.parameters ?? {});
  const gate = checks.find((p) => (p.required_status_checks ?? []).some((c) => c.context === 'release-gate'));
  if (!gate) {
    problems.push('release-gate is not a required status check');
  } else {
    const entry = gate.required_status_checks.find((c) => c.context === 'release-gate');
    if (entry.integration_id !== GITHUB_ACTIONS_APP_ID) {
      problems.push(`release-gate is not pinned to GitHub Actions (integration ${entry.integration_id ?? 'any'})`);
    }
    if (gate.strict_required_status_checks_policy !== true) {
      problems.push('release-gate does not require the branch to be up to date with main before merging');
    }
  }
  if (!byType.has('non_fast_forward')) problems.push('force pushes are not blocked');
  if (!byType.has('deletion')) problems.push('the branch can be deleted');
  return problems;
}

async function main() {
  const repo = process.argv[2] || process.env.GITHUB_REPOSITORY || 'n89b-dot/DRVN-2';
  const branch = process.argv[3] || 'main';
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/rules/branches/${encodeURIComponent(branch)}`, { headers });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for the rules on ${repo}@${branch}`);
  const problems = protectionProblems(await res.json());
  if (problems.length) {
    for (const problem of problems) console.log(`::error title=${branch} is not protected::${problem}`);
    throw new Error(`${repo}@${branch} is not protected as docs/owner/branch-protection.md sets it up: ${problems.join('; ')}. Re-apply with scripts/owner/branch-protection.sh --apply.`);
  }
  console.log(`${repo}@${branch} is protected: pull requests, release-gate (GitHub Actions, up to date), no force push, no deletion.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
