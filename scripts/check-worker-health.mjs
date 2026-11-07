import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Kept equal to src/lib/job-inventory.ts and private.scheduled_job_inventory()
// (20261107191000) by src/lib/job-inventory.test.ts. The monitor holds its own
// copy so a deployment that silently drops a family or job still fails here.
export const REQUIRED_FAMILIES = ['agent', 'deletions', 'deliveryAutoConfirm', 'listingImports', 'media', 'savedSearches', 'search', 'expiries', 'captures', 'transfers', 'transferReconciliation', 'refunds', 'labelVoids', 'returns', 'disputes', 'alerts', 'receipts', 'analytics'];
export const REQUIRED_JOBS = ['drvn-agent-worker', 'drvn-cron-history-prune', 'drvn-deletion-worker', 'drvn-delivery-auto-confirm', 'drvn-dispute-sla', 'drvn-explore-builders', 'drvn-explore-trending', 'drvn-grow-products', 'drvn-grow-products-full', 'drvn-listing-edit-sweep', 'drvn-listing-import-sweep', 'drvn-marketplace-counts', 'drvn-media-gc', 'drvn-prune-rate-limits', 'drvn-release-reservations', 'drvn-saved-search-worker', 'drvn-search-words', 'drvn-search-worker', 'drvn-transfer-worker'];
export const RUNBOOK = 'docs/production-runbook.md §9b';
// Every configuration check the app reports (src/lib/worker-health.ts
// HealthConfigStatus) and the values it may take. Health is only healthy when
// each is present and 'ok'; a missing or unknown value is an incomplete body.
export const REQUIRED_CONFIG = {
  scheduler: ['ok', 'missing'],
  runHistory: ['ok', 'disabled'],
  pgNet: ['ok', 'missing'],
  workerUrl: ['ok', 'missing', 'invalid'],
  workerSecret: ['ok', 'missing', 'mismatch', 'unchecked'],
};
const MAX_PROBLEMS = 20;

class MonitorError extends Error {
  constructor(code, problems = []) { super(code); this.name = 'MonitorError'; this.problems = problems; }
}
function endpoint(value, local = false) {
  let target;
  try { target = new URL(value); } catch { throw new MonitorError('invalid_monitor_endpoint'); }
  if (target.username || target.password || target.hash || (target.protocol !== 'https:' && !(local && target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname)))) throw new MonitorError('monitor_endpoint_requires_HTTPS');
  return target;
}

const AREAS = new Set(['family', 'job', 'queue', 'config']);
const NAME = /^[A-Za-z0-9_.:/-]{1,120}$/;
const REASON = /^[a-z_]{1,60}$/;
/** Only names, reasons, counts and timestamps reach a paging destination;
 * anything else the app sends is dropped. */
function cleanProblem(p) {
  if (!p || !AREAS.has(p.area) || typeof p.name !== 'string' || !NAME.test(p.name) || typeof p.reason !== 'string' || !REASON.test(p.reason)) return null;
  const out = { area: p.area, name: p.name, reason: p.reason };
  if (typeof p.since === 'string' && p.since.length <= 40 && !Number.isNaN(Date.parse(p.since))) out.since = p.since;
  if (Number.isSafeInteger(p.count)) out.count = p.count;
  if (Number.isSafeInteger(p.attempts)) out.attempts = p.attempts;
  return out;
}
const problemKey = p => `${p.area}:${p.name}:${p.reason}`;
export function describeProblem(p) {
  return `${p.area} ${p.name}: ${p.reason.replaceAll('_', ' ')}${p.count != null ? ` (${p.count}${p.attempts != null ? `, up to ${p.attempts} attempts` : ''})` : ''}${p.since ? ` since ${p.since}` : ''}`;
}

/**
 * Independent checks verify exact families and jobs: duplicate rows are not
 * proof. Health that cannot be read is an error code; health that reads but
 * needs attention throws 'worker_health_unhealthy' with the problems found,
 * both those the app reported and those this monitor finds itself.
 */
export async function checkWorkerHealth(url, secret, transport = fetch) {
  if (!url || !secret) throw new MonitorError('monitor_configuration_missing');
  const origin = endpoint(url, true);
  if (origin.pathname !== '/' || origin.search) throw new MonitorError('monitor_origin_must_be_canonical');
  let response;
  try { response = await transport(new URL('/api/health/workers', origin), { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10000), redirect: 'error' }); }
  catch { throw new MonitorError('worker_health_unreachable'); }
  // 503 carries the same body as 200 plus problems; anything else is an outage.
  if (response.status !== 200 && response.status !== 503) throw new MonitorError(`worker_health_HTTP_${response.status}`);
  let health;
  try { health = await response.json(); } catch { throw new MonitorError(response.ok ? 'worker_health_invalid_JSON' : `worker_health_HTTP_${response.status}`); }
  if (!response.ok && (!health || health.error || !Array.isArray(health.families))) throw new MonitorError(`worker_health_HTTP_${response.status}`);

  const { families, jobs, queues } = health ?? {};
  const rowsValid = (rows, key) => Array.isArray(rows) && rows.every(x => x && typeof x[key] === 'string' && typeof x.stale === 'boolean' && (x.disabled === undefined || typeof x.disabled === 'boolean')) && new Set(rows.map(x => x[key])).size === rows.length;
  if (!rowsValid(families, 'family') || !rowsValid(jobs, 'job') || !Array.isArray(queues) || queues.some(x => !x || typeof x.status !== 'string' || typeof x.kind !== 'string' || typeof x.overdue !== 'boolean' || (x.disabled !== undefined && typeof x.disabled !== 'boolean'))) throw new MonitorError('worker_health_incomplete');
  const config = health.config !== null && typeof health.config === 'object' && !Array.isArray(health.config) ? health.config : {};
  const missing = [
    ...REQUIRED_FAMILIES.filter(name => !families.some(x => x.family === name)).map(name => ({ area: 'family', name, reason: 'missing' })),
    ...REQUIRED_JOBS.filter(name => !jobs.some(x => x.job === name)).map(name => ({ area: 'job', name, reason: 'missing' })),
    ...Object.entries(REQUIRED_CONFIG).filter(([name, allowed]) => !allowed.includes(config[name])).map(([name]) => ({ area: 'config', name, reason: name in config ? 'malformed' : 'missing' })),
  ];
  if (missing.length) throw new MonitorError('worker_health_incomplete', missing);

  const found = new Map();
  const add = p => { const clean = cleanProblem(p); if (clean && !found.has(problemKey(clean))) found.set(problemKey(clean), clean); };
  for (const x of families) if (x.stale && !x.disabled) add({ area: 'family', name: x.family, reason: x.reason ?? 'stale', since: x.last_success });
  for (const x of jobs) if (x.stale && !x.disabled) add({ area: 'job', name: x.job, reason: x.reason ?? 'stale', since: x.last_success });
  for (const x of queues) if (!x.disabled && (x.overdue || x.kind === 'capture_recovery' || x.kind === 'financial_recovery')) add({ area: 'queue', name: `${x.kind}/${x.status}`, reason: 'overdue', since: x.oldest, count: x.count, attempts: x.attempts_max });
  // An unverified secret is not a verified one: only 'ok' passes.
  for (const name of Object.keys(REQUIRED_CONFIG)) if (config[name] !== 'ok') add({ area: 'config', name, reason: config[name] });
  for (const p of Array.isArray(health.problems) ? health.problems : []) add(p);
  if (found.size) throw new MonitorError('worker_health_unhealthy', [...found.values()]);
  // Healthy-looking data under a 503 is still a 503.
  if (!response.ok) throw new MonitorError(`worker_health_HTTP_${response.status}`);
  return { healthy: true, families: families.length, jobs: jobs.length };
}

const fingerprint = (code, problems) => (problems.length ? problems.map(problemKey) : [code]).sort().join('\n');
const hasNew = (before, after) => { const seen = new Set((before ?? '').split('\n')); return after.split('\n').some(key => !seen.has(key)); };

/** Transition state belongs to the independent runner, never the failing app.
 * Do not acknowledge notification state until the external destination accepts it.
 *
 * Noise control: an incident pages after `confirmChecks` consecutive failing
 * checks (default 2), again only when a problem not already paged appears
 * ('worsened') or every `escalateAfterMs` while it lasts ('still_unhealthy'),
 * and once on recovery. While `silenceUntil` (an ISO time) is in the future
 * nothing is sent; an incident still open when it ends pages then. */
export async function monitorCycle(config, prior = {}, transport = fetch, now = Date.now(), persist = async () => {}) {
  let health;
  let code = 'healthy';
  let problems = [];
  try { health = await checkWorkerHealth(config.origin, config.secret, transport); }
  catch (error) {
    code = error instanceof MonitorError ? error.message : 'worker_health_check_failed';
    problems = error instanceof MonitorError ? error.problems : [];
  }
  const healthy = code === 'healthy';
  const state = { ...prior, lastCheckedAt: new Date(now).toISOString(), healthy, code, failingChecks: healthy ? 0 : (prior.failingChecks ?? 0) + 1 };
  const incidentStartedAt = healthy ? null : prior.incidentStartedAt ?? new Date(now).toISOString();
  state.incidentStartedAt = incidentStartedAt;
  const print = healthy ? '' : fingerprint(code, problems);
  const notifiedUnhealthy = prior.notifiedHealthy === false;
  let kind = null;
  if (healthy) { if (notifiedUnhealthy) kind = 'recovered'; }
  else if (state.failingChecks >= (config.confirmChecks ?? 2)) {
    if (!notifiedUnhealthy) kind = 'unhealthy';
    else if (hasNew(prior.notifiedFingerprint, print)) kind = 'worsened';
    else if (now - Date.parse(prior.lastNotifiedAt ?? '') >= (config.escalateAfterMs ?? 30 * 60_000)) kind = 'still_unhealthy';
  }
  const silenced = Boolean(config.silenceUntil) && now < Date.parse(config.silenceUntil);
  if (kind && silenced) { state.suppressedKind = kind; kind = null; } else delete state.suppressedKind;
  if (kind) {
    if (!config.alertUrl) throw new MonitorError('independent_alert_destination_missing');
    const target = endpoint(config.alertUrl);
    const started = prior.incidentStartedAt ?? incidentStartedAt;
    const notificationId = prior.pendingNotificationKind === kind ? prior.pendingNotificationId : `${started}:${kind}:${prior.lastNotifiedAt ?? 'initial'}`;
    state.pendingNotificationId = notificationId;
    state.pendingNotificationKind = kind;
    await persist(state); // Preserve incident identity before uncertain external delivery.
    const listed = problems.slice(0, MAX_PROBLEMS);
    const summary = healthy ? 'DRVN workers recovered' : `DRVN workers: ${problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'} — ${listed.map(describeProblem).join('; ')}${problems.length > listed.length ? '; …' : ''}` : code.replaceAll('_', ' ')}`;
    const body = { service: 'DRVN workers', notificationId, kind, code, summary, problems: listed, problemCount: problems.length, incidentStartedAt: started, checkedAt: state.lastCheckedAt, runbook: RUNBOOK };
    const response = await transport(target, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }).catch(() => { throw new MonitorError('independent_alert_delivery_failed'); });
    if (!response.ok) throw new MonitorError('independent_alert_delivery_failed');
    delete state.pendingNotificationId;
    delete state.pendingNotificationKind;
    state.notifiedHealthy = healthy;
    state.lastNotifiedAt = state.lastCheckedAt;
    if (healthy) delete state.notifiedFingerprint; else state.notifiedFingerprint = print;
  } else if (healthy && prior.notifiedHealthy === undefined) state.notifiedHealthy = true;
  // Dead-man destination receives success only after health validation and
  // required transition delivery; a dead runner cannot keep this alive.
  if (healthy && config.heartbeatUrl) {
    const response = await transport(endpoint(config.heartbeatUrl), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000) }).catch(() => { throw new MonitorError('independent_heartbeat_failed'); });
    if (!response.ok) throw new MonitorError('independent_heartbeat_failed');
  }
  return { state, result: healthy ? health : { healthy: false, code, problems } };
}

function reportFailure(error) {
  const code = error instanceof MonitorError ? error.message : 'independent_monitor_failed';
  const problems = error instanceof MonitorError ? error.problems : [];
  console.error(problems.length ? `${code}: ${problems.map(describeProblem).join('; ')}` : code);
  // One annotation per problem on the workflow run, so the failure email and
  // the run page say what to fix.
  if (process.env.GITHUB_ACTIONS === 'true') for (const p of problems.length ? problems : [{ area: 'config', name: 'monitor', reason: code }]) console.log(`::error title=DRVN worker health::${describeProblem(p)} (${RUNBOOK})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const watch = process.argv.includes('--watch');
  const statePath = process.env.DRVN_MONITOR_STATE_FILE;
  const confirmChecks = Number(process.env.DRVN_MONITOR_CONFIRM_CHECKS ?? 2);
  const silenceUntil = process.env.DRVN_MONITOR_SILENCE_UNTIL || undefined;
  const config = { origin: process.env.DRVN_MONITOR_ORIGIN, secret: process.env.DRVN_MONITOR_SECRET, alertUrl: process.env.DRVN_MONITOR_ALERT_URL, heartbeatUrl: process.env.DRVN_MONITOR_HEARTBEAT_URL, confirmChecks, silenceUntil };
  const interval = Number(process.env.DRVN_MONITOR_INTERVAL_MS ?? 60_000);
  if (watch && (!statePath || !config.alertUrl || !config.heartbeatUrl || !Number.isInteger(interval) || interval < 10_000 || interval > 120_000 || !Number.isInteger(confirmChecks) || confirmChecks < 1 || confirmChecks > 10 || (silenceUntil && Number.isNaN(Date.parse(silenceUntil))))) {
    console.error('independent_monitor_configuration_incomplete'); process.exitCode = 1;
  } else {
    do {
      try {
        if (!watch) console.log(JSON.stringify(await checkWorkerHealth(config.origin, config.secret)));
        else {
          let prior = {};
          try { prior = JSON.parse(readFileSync(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new MonitorError('monitor_state_unreadable'); }
          const persist = async state => {writeFileSync(`${statePath}.tmp`, JSON.stringify(state), {mode: 0o600}); renameSync(`${statePath}.tmp`, statePath);};
          const {state,result} = await monitorCycle(config, prior, fetch, Date.now(), persist);
          await persist(state);
          console.log(JSON.stringify(result));
        }
      } catch (error) { reportFailure(error); if (!watch) process.exitCode = 1; }
      if (watch) await new Promise(resolve => setTimeout(resolve, interval));
    } while (watch);
  }
}
