import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWorkerHealth } from './check-worker-health.mjs';
const healthy = { families: Array.from({ length: 14 }, () => ({ stale: false })), queues: [] };
test('accepts complete healthy state and keeps the bearer out of results', async () => {
 const result = await checkWorkerHealth('https://drvn.example', 'secret', async (_url, init) => { assert.equal(init.redirect, 'error'); return Response.json(healthy); });
 assert.deepEqual(result, { healthy: true, families: 14 });
});
test('fails on unavailable, malformed, stale and exhausted health', async () => {
 for (const response of [new Response(null, { status: 503 }), Response.json({}), Response.json({ ...healthy, families: [{ stale: true }] }), Response.json({ ...healthy, queues: [{ status: 'failed' }] })]) {
  await assert.rejects(checkWorkerHealth('https://drvn.example', 'secret', async () => response));
 }
});
test('never sends a bearer over remote HTTP', async () => {
 await assert.rejects(checkWorkerHealth('http://drvn.example', 'secret', async () => { throw new Error('must not fetch'); }), /HTTPS/);
});
