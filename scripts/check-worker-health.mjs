// Run on an independent scheduler. Never print credentials or response payloads.
export async function checkWorkerHealth(url, secret, transport = fetch) {
  if (!url || !secret) throw new Error('Worker monitor origin and bearer secret are required');
  const origin = new URL(url);
  if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Remote monitoring requires HTTPS');
  const response = await transport(new URL('/api/health/workers', origin), { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error(`Worker health HTTP ${response.status}`);
  const health = await response.json();
  if (!Array.isArray(health.families) || health.families.length < 14 || health.families.some(x => x.stale !== false)) throw new Error('Worker health is incomplete or stale');
  if (!Array.isArray(health.queues) || health.queues.some(x => !x.disabled && (x.status === 'failed' || x.kind === 'capture_recovery'))) throw new Error('Worker backlog requires attention');
  return { healthy: true, families: health.families.length };
}
if (process.argv[1]?.endsWith('/check-worker-health.mjs')) {
  try { console.log(JSON.stringify(await checkWorkerHealth(process.env.DRVN_MONITOR_ORIGIN, process.env.DRVN_MONITOR_SECRET))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
