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
// It also checks how the commit at the head got there (a merge of a pull
// request head that passed release-gate while level with main), and that the
// production environment, once it exists, has required reviewers.
//
//   node scripts/check-branch-protection.mjs [owner/repo] [branch]
//   node scripts/check-branch-protection.mjs --environment production [owner/repo]
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

/**
 * What is wrong with how the commit now at the branch's head got there
 * (work review #156, N1072). The rules above are read after the merge, so
 * protection that was removed, used and put back within the hour left no
 * trace. The merge itself does: every change reaches `main` as a merge
 * commit whose second parent is the pull request's head, and that head must
 * have passed `release-gate` while level with the first parent.
 *
 * @param {{ sha: string, parents: { sha: string }[] }} commit   GET /repos/{repo}/commits/{sha}
 * @param {any[]} checkRuns   check runs on the second parent (the pull request's head)
 * @param {{ behind_by?: number } | null} compare   GET /compare/{first parent}...{second parent}
 * @returns {string[]}
 */
export function mergedHeadProblems(commit, checkRuns, compare) {
  const short = (sha) => String(sha ?? '').slice(0, 7);
  const parents = commit?.parents ?? [];
  if (parents.length !== 2) {
    return [`${short(commit?.sha)} is not a merge commit (${parents.length} parent${parents.length === 1 ? '' : 's'}): it was pushed to the branch without a pull request`];
  }
  const head = parents[1].sha;
  const problems = [];
  const gates = (checkRuns ?? []).filter((run) => run?.name === 'release-gate');
  const newest = [...gates].sort((a, b) => Date.parse(b.started_at ?? 0) - Date.parse(a.started_at ?? 0))[0];
  if (!newest) problems.push(`release-gate never ran on ${short(head)}, the pull request head merged as ${short(commit.sha)}`);
  else if (newest.status !== 'completed' || newest.conclusion !== 'success') {
    problems.push(`release-gate was ${newest.status === 'completed' ? newest.conclusion : newest.status} on ${short(head)} when it merged as ${short(commit.sha)}`);
  }
  if (!compare || typeof compare.behind_by !== 'number') problems.push(`could not tell whether ${short(head)} was level with main when it merged`);
  else if (compare.behind_by > 0) problems.push(`${short(head)} was ${compare.behind_by} commit(s) behind main when it merged as ${short(commit.sha)}`);
  return problems;
}

/**
 * What is wrong with a GitHub deployment environment (work review #139,
 * N1055). A job that names an environment which does not exist makes GitHub
 * create it, empty, and run: no reviewer, no restriction, every secret of
 * that name readable. So the production deploy asks first, in a job that
 * names no environment.
 *
 * @param {string} name
 * @param {number} status   the HTTP status of GET /repos/{repo}/environments/{name}
 * @param {any} body
 * @returns {string[]}
 */
export function environmentProblems(name, status, body) {
  if (status === 404) return [`the ${name} environment does not exist: create it in Settings → Environments with required reviewers before anything deploys to it`];
  if (status !== 200 || !body) return [`GitHub answered ${status} for the ${name} environment`];
  const problems = [];
  const reviewers = (body.protection_rules ?? []).filter((rule) => rule?.type === 'required_reviewers').flatMap((rule) => rule.reviewers ?? []);
  if (!reviewers.length) problems.push(`the ${name} environment has no required reviewers: a deploy to it would not wait for a person`);
  if (!body.deployment_branch_policy) problems.push(`the ${name} environment lets any branch or tag deploy to it ("Deployment branches and tags" is "No restriction")`);
  return problems;
}

const api = (path, headers) => fetch(`https://api.github.com${path}`, { headers });

function requestHeaders() {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

/** `--environment <name>`: fail unless that environment exists, has required reviewers and restricts what may deploy. */
async function checkEnvironment(repo, name) {
  const res = await api(`/repos/${repo}/environments/${encodeURIComponent(name)}`, requestHeaders());
  const problems = environmentProblems(name, res.status, res.ok ? await res.json() : null);
  if (problems.length) {
    for (const problem of problems) console.log(`::error title=${name} environment is not guarded::${problem}`);
    throw new Error(`${repo}: ${problems.join('; ')} (docs/staging-setup.md §11.4).`);
  }
  console.log(`${repo}: the ${name} environment has required reviewers and restricts what may deploy to it.`);
}

async function main() {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--environment');
  if (flag >= 0) {
    const name = args[flag + 1];
    if (!name) throw new Error('--environment needs the environment\'s name');
    const rest = args.filter((_, index) => index !== flag && index !== flag + 1);
    return checkEnvironment(rest[0] || process.env.GITHUB_REPOSITORY || 'n89b-dot/DRVN-2', name);
  }
  const repo = args[0] || process.env.GITHUB_REPOSITORY || 'n89b-dot/DRVN-2';
  const branch = args[1] || 'main';
  const headers = requestHeaders();
  const res = await api(`/repos/${repo}/rules/branches/${encodeURIComponent(branch)}`, headers);
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for the rules on ${repo}@${branch}`);
  const problems = protectionProblems(await res.json());

  // How the commit now at the head got there (a removal that was put back leaves the rules looking fine).
  const commitRes = await api(`/repos/${repo}/commits/${encodeURIComponent(branch)}`, headers);
  if (!commitRes.ok) throw new Error(`GitHub answered ${commitRes.status} for the head of ${repo}@${branch}`);
  const commit = await commitRes.json();
  let checkRuns = [];
  let compare = null;
  if ((commit.parents ?? []).length === 2) {
    const [base, head] = commit.parents.map((parent) => parent.sha);
    const runsRes = await api(`/repos/${repo}/commits/${head}/check-runs?check_name=release-gate&per_page=100`, headers);
    if (!runsRes.ok) throw new Error(`GitHub answered ${runsRes.status} for the check runs on ${head}`);
    checkRuns = (await runsRes.json()).check_runs;
    const compareRes = await api(`/repos/${repo}/compare/${base}...${head}`, headers);
    compare = compareRes.ok ? await compareRes.json() : null;
  }
  problems.push(...mergedHeadProblems(commit, checkRuns, compare));

  // The production environment, once it exists: never unguarded. Before the owner creates it, there is nothing to guard.
  const envRes = await api(`/repos/${repo}/environments/production`, headers);
  if (envRes.status !== 404) problems.push(...environmentProblems('production', envRes.status, envRes.ok ? await envRes.json() : null));

  if (problems.length) {
    for (const problem of problems) console.log(`::error title=${branch} is not protected::${problem}`);
    throw new Error(`${repo}@${branch} is not protected as docs/owner/branch-protection.md sets it up: ${problems.join('; ')}. Re-apply with scripts/owner/branch-protection.sh --apply.`);
  }
  console.log(`${repo}@${branch} is protected: pull requests, release-gate (GitHub Actions, up to date), no force push, no deletion; ${String(commit.sha).slice(0, 7)} merged from a head that passed release-gate while level with main${envRes.status === 404 ? '; the production environment does not exist yet' : '; the production environment is guarded'}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
