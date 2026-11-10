// The deploy pipeline's checks (N634, N528; .github/workflows/deploy.yml).
// Each subcommand is one gate the workflow runs before or after it asks the
// host to deploy; the decisions are pure functions so tests/ci/deploy.test.ts
// can hold them without a network.
//
//   node scripts/deploy.mjs gate <sha>                 wait for release-gate to succeed on <sha>
//   node scripts/deploy.mjs migrations <status.json>   refuse when the target is missing a migration
//   node scripts/deploy.mjs version <origin> <sha>     wait for <origin>/api/version to report <sha>
//   node scripts/deploy.mjs tag <name>                 refuse a tag that is not rc-YYYYMMDD[-n]
//   node scripts/deploy.mjs alert <text>               post <text> to ADMIN_ALERT_WEBHOOK_URL, if set
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const GATE_CHECK = 'release-gate';
export const RELEASE_TAG = /^rc-(\d{4})(\d{2})(\d{2})(?:-\d{1,2})?$/;

/** What the release-gate check runs on a commit say: 'passed', 'failed' or 'pending'. */
export function gateVerdict(checkRuns) {
  const gates = (checkRuns ?? []).filter((run) => run && run.name === GATE_CHECK);
  if (!gates.length) return 'pending';
  // The newest run decides: a rerun that passed after a failure counts.
  const newest = [...gates].sort((a, b) => Date.parse(b.started_at ?? 0) - Date.parse(a.started_at ?? 0))[0];
  if (newest.status !== 'completed') return 'pending';
  return newest.conclusion === 'success' ? 'passed' : 'failed';
}

/** The files the runner's --status JSON says the target lacks. */
export function missingMigrations(status) {
  if (!status || !Array.isArray(status.missing) || typeof status.target !== 'string') {
    throw new Error('Not the runner\'s --status output (scripts/apply-migration.mjs --status)');
  }
  return [...status.missing];
}

/** Whether /api/version's body names the commit (full sha, or a prefix of at least 7). */
export function versionMatches(body, sha) {
  const reported = body && typeof body.sha === 'string' ? body.sha : '';
  return reported.length >= 7 && sha.length >= 7 && (reported.startsWith(sha) || sha.startsWith(reported));
}

/** True for rc-YYYYMMDD or rc-YYYYMMDD-n with a real calendar date. */
export function validReleaseTag(name) {
  const m = RELEASE_TAG.exec(String(name ?? ''));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** The alert webhook's body (Slack-compatible `text`). */
export function alertPayload(text) {
  return { text: String(text).slice(0, 3000) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Whether `sha` is still main's head (Codex on #175). Concurrency serialises
 * staging runs but doesn't order them: a delayed or re-run older run that
 * gets the lock after a newer one would deploy the older commit over it.
 */
export function stillHead(headSha, sha) {
  return typeof headSha === 'string' && typeof sha === 'string' && headSha.length >= 7 && headSha === sha;
}

async function mainHead() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const res = await fetch(`https://api.github.com/repos/${repo}/commits/main`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GitHub commits answered ${res.status}`);
  return (await res.json()).sha;
}

async function waitForGate(sha, { timeoutMinutes = 90, intervalSeconds = 60 } = {}) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const deadline = Date.now() + timeoutMinutes * 60_000;
  for (;;) {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?check_name=${GATE_CHECK}&per_page=100`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    });
    if (!res.ok) throw new Error(`GitHub check-runs answered ${res.status}`);
    const verdict = gateVerdict((await res.json()).check_runs);
    if (verdict === 'passed') return console.log(`${GATE_CHECK} passed on ${sha}`);
    if (verdict === 'failed') throw new Error(`${GATE_CHECK} failed on ${sha}: nothing is deployed`);
    if (Date.now() > deadline) throw new Error(`${GATE_CHECK} did not finish on ${sha} within ${timeoutMinutes} minutes`);
    await sleep(intervalSeconds * 1000);
  }
}

async function waitForVersion(origin, sha, { timeoutMinutes = 15, intervalSeconds = 20 } = {}) {
  const url = new URL('/api/version', origin);
  if (url.protocol !== 'https:') throw new Error('The deployed origin must be https');
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let last = null;
  for (;;) {
    try {
      const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
      if (res.ok) {
        last = await res.json();
        if (versionMatches(last, sha)) return console.log(`${url.origin} reports ${last.sha}`);
      }
    } catch {
      // A deploy in progress can refuse connections for a moment.
    }
    if (Date.now() > deadline) throw new Error(`${url.origin} still reports ${last?.sha ?? 'nothing'}, not ${sha}, after ${timeoutMinutes} minutes`);
    await sleep(intervalSeconds * 1000);
  }
}

async function postAlert(text) {
  const hook = process.env.ADMIN_ALERT_WEBHOOK_URL;
  if (!hook) return console.log('No ADMIN_ALERT_WEBHOOK_URL: alert not sent');
  const res = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(alertPayload(text)) });
  if (!res.ok) throw new Error(`The alert webhook answered ${res.status}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, a, b] = process.argv.slice(2);
  try {
    if (command === 'gate' && a) await waitForGate(a);
    else if (command === 'current' && a) {
      // Prints current=true|false for $GITHUB_OUTPUT; a superseded run skips its deploy, not fails.
      const head = await mainHead();
      const current = stillHead(head, a);
      if (!current) console.error(`main is now at ${head}: ${a} is superseded, so this run deploys nothing`);
      console.log(`current=${current}`);
    }
    else if (command === 'migrations' && a) {
      const missing = missingMigrations(JSON.parse(readFileSync(a, 'utf8')));
      if (missing.length) {
        throw new Error(`The target is missing ${missing.length} migration(s): ${missing.join(', ')}. Apply them with scripts/apply-migration.mjs (supabase/MIGRATIONS.md) before deploying; this pipeline never applies migrations itself.`);
      }
      console.log('The target has every migration on disk.');
    } else if (command === 'version' && a && b) await waitForVersion(a, b);
    else if (command === 'tag' && a) {
      if (!validReleaseTag(a)) throw new Error(`"${a}" is not a release tag (rc-YYYYMMDD or rc-YYYYMMDD-n)`);
      console.log(`${a} is a release tag`);
    } else if (command === 'alert' && a) await postAlert(a);
    else throw new Error('Usage: deploy.mjs gate SHA | current SHA | migrations STATUS.json | version ORIGIN SHA | tag NAME | alert TEXT');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
