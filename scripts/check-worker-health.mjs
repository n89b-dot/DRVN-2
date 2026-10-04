import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REQUIRED_FAMILIES = ['expiries', 'captures', 'transfers', 'transferReconciliation', 'refunds', 'labelVoids', 'returns', 'disputes', 'alerts', 'receipts', 'analytics', 'search', 'deletions', 'savedSearches', 'media', 'listingImports', 'deliveryAutoConfirm'];
class MonitorError extends Error { constructor(code) { super(code); this.name = 'MonitorError'; } }
function endpoint(value, local = false) {
  let target;
  try { target = new URL(value); } catch { throw new MonitorError('invalid_monitor_endpoint'); }
  if (target.username || target.password || target.hash || (target.protocol !== 'https:' && !(local && target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname)))) throw new MonitorError('monitor_endpoint_requires_HTTPS');
  return target;
}

// Independent checks verify exact families: duplicate rows are not proof.
export async function checkWorkerHealth(url, secret, transport = fetch) {
  if (!url || !secret) throw new MonitorError('monitor_configuration_missing');
  const origin = endpoint(url, true);
  if (origin.pathname !== '/' || origin.search) throw new MonitorError('monitor_origin_must_be_canonical');
  let response;
  try { response = await transport(new URL('/api/health/workers', origin), { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10000), redirect: 'error' }); }
  catch { throw new MonitorError('worker_health_unreachable'); }
  if (!response.ok) throw new MonitorError(`worker_health_HTTP_${response.status}`);
  let health;
  try { health = await response.json(); } catch { throw new MonitorError('worker_health_invalid_JSON'); }
  const families = health?.families;
  if (!Array.isArray(families) || new Set(families.map(x => x?.family)).size !== families.length || REQUIRED_FAMILIES.some(name => !families.some(x => x?.family === name)) || families.some(x => !x || x.stale !== false || (x.disabled !== undefined && typeof x.disabled !== 'boolean'))) throw new MonitorError('worker_health_incomplete_or_stale');
  if (!Array.isArray(health.queues) || health.queues.some(x => !x || typeof x.status !== 'string' || typeof x.kind !== 'string' || typeof x.overdue !== 'boolean' || (x.disabled !== undefined && typeof x.disabled !== 'boolean') || (!x.disabled && (x.overdue === true || x.status === 'failed' || x.kind === 'capture_recovery' || x.kind === 'financial_recovery')))) throw new MonitorError('worker_backlog_requires_attention');
  return { healthy: true, families: families.length };
}

/** Transition state belongs to the independent runner, never the failing app.
 * Do not acknowledge notification state until the external destination accepts it. */
export async function monitorCycle(config, prior = {}, transport = fetch, now = Date.now(), persist = async () => {}) {
  let health;
  let code = 'healthy';
  try { health = await checkWorkerHealth(config.origin, config.secret, transport); }
  catch (error) { code = error instanceof MonitorError ? error.message : 'worker_health_check_failed'; }
  const healthy = code === 'healthy';
  const state = { ...prior, lastCheckedAt: new Date(now).toISOString(), healthy, code };
  const incidentStartedAt = healthy ? null : prior.incidentStartedAt ?? new Date(now).toISOString();
  state.incidentStartedAt = incidentStartedAt;
  const transition = prior.notifiedHealthy !== healthy;
  const escalating = !healthy && prior.notifiedHealthy === false && now - Date.parse(prior.lastNotifiedAt ?? '') >= (config.escalateAfterMs ?? 30 * 60_000);
  // Initial healthy check stays quiet. Failed delivery is retried next cycle.
  if ((!healthy && (transition || escalating)) || (healthy && prior.notifiedHealthy === false)) {
    if (!config.alertUrl) throw new MonitorError('independent_alert_destination_missing');
    const target = endpoint(config.alertUrl);
    const kind = healthy ? 'recovered' : escalating ? 'still_unhealthy' : 'unhealthy';
    const notificationId = prior.pendingNotificationKind === kind ? prior.pendingNotificationId : `${prior.incidentStartedAt ?? incidentStartedAt}:${kind}:${prior.lastNotifiedAt ?? 'initial'}`;
    state.pendingNotificationId = notificationId;
    state.pendingNotificationKind = kind;
    await persist(state); // Preserve incident identity before uncertain external delivery.
    const response = await transport(target, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service: 'DRVN workers', notificationId, kind, code, incidentStartedAt: prior.incidentStartedAt ?? incidentStartedAt, checkedAt: state.lastCheckedAt }), signal: AbortSignal.timeout(10000) }).catch(() => { throw new MonitorError('independent_alert_delivery_failed'); });
    if (!response.ok) throw new MonitorError('independent_alert_delivery_failed');
    delete state.pendingNotificationId;
    delete state.pendingNotificationKind;
    state.notifiedHealthy = healthy;
    state.lastNotifiedAt = state.lastCheckedAt;
  } else if (healthy && prior.notifiedHealthy === undefined) state.notifiedHealthy = true;
  // Dead-man destination receives success only after health validation and
  // required transition delivery; a dead runner cannot keep this alive.
  if (healthy && config.heartbeatUrl) {
    const response = await transport(endpoint(config.heartbeatUrl), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000) }).catch(() => { throw new MonitorError('independent_heartbeat_failed'); });
    if (!response.ok) throw new MonitorError('independent_heartbeat_failed');
  }
  return { state, result: healthy ? health : { healthy: false, code } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const watch = process.argv.includes('--watch');
  const statePath = process.env.DRVN_MONITOR_STATE_FILE;
  const config = { origin: process.env.DRVN_MONITOR_ORIGIN, secret: process.env.DRVN_MONITOR_SECRET, alertUrl: process.env.DRVN_MONITOR_ALERT_URL, heartbeatUrl: process.env.DRVN_MONITOR_HEARTBEAT_URL };
  const interval = Number(process.env.DRVN_MONITOR_INTERVAL_MS ?? 60_000);
  if (watch && (!statePath || !config.alertUrl || !config.heartbeatUrl || !Number.isInteger(interval) || interval < 10_000 || interval > 120_000)) {
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
      } catch (error) { console.error(error instanceof MonitorError ? error.message : 'independent_monitor_failed'); if (!watch) process.exitCode = 1; }
      if (watch) await new Promise(resolve => setTimeout(resolve, interval));
    } while (watch);
  }
}
