import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWorkerHealth, monitorCycle, REQUIRED_FAMILIES } from './check-worker-health.mjs';
const healthy = { families: REQUIRED_FAMILIES.map(family => ({ family, stale: false })), queues: [] };
test('accepts complete healthy state and keeps the bearer out of results', async () => {
 const result = await checkWorkerHealth('https://drvn.example', 'secret', async (_url, init) => { assert.equal(init.redirect, 'error'); return Response.json(healthy); });
 assert.deepEqual(result, { healthy: true, families: 15 });
});
test('fails on unavailable, malformed, stale and exhausted health', async () => {
 for (const response of [new Response(null, { status: 503 }), Response.json({}), Response.json({ ...healthy, families: [{ stale: true }] }), Response.json({ ...healthy, queues: [{ status: 'failed' }] })]) {
  await assert.rejects(checkWorkerHealth('https://drvn.example', 'secret', async () => response));
 }
});
test('never sends a bearer over remote HTTP', async () => {
 await assert.rejects(checkWorkerHealth('http://drvn.example', 'secret', async () => { throw new Error('must not fetch'); }), /HTTPS/);
});

test('rejects duplicated inventory and transport errors without leaking request secrets', async () => {
 await assert.rejects(checkWorkerHealth('https://drvn.example', 'secret', async () => Response.json({families:Array.from({length:15},()=>({family:'alerts',stale:false})),queues:[]})), /incomplete/);
 await assert.rejects(checkWorkerHealth('https://drvn.example', 'secret', async () => {throw new Error('secret in upstream error');}), error => !error.message.includes('secret'));
});
test('notifies failure once, escalates, and notifies recovery; health heartbeat is independent', async () => {
 const sent=[];let failing=true;
 const config={origin:'https://drvn.example',secret:'secret',alertUrl:'https://alerts.example/hook',heartbeatUrl:'https://heartbeat.example/ping',escalateAfterMs:1000};
 const transport=async (url,init)=>{if(url.hostname==='drvn.example') return failing?new Response(null,{status:503}):Response.json(healthy); sent.push({host:url.hostname,body:init.body&&JSON.parse(init.body)});return new Response(null,{status:204});};
 let result=await monitorCycle(config,{},transport,10000);assert.equal(sent[0].body.kind,'unhealthy');
 result=await monitorCycle(config,result.state,transport,10500);assert.equal(sent.length,1);
 result=await monitorCycle(config,result.state,transport,11001);assert.equal(sent[1].body.kind,'still_unhealthy');
 failing=false;await monitorCycle(config,result.state,transport,12000);assert.equal(sent[2].body.kind,'recovered');assert.equal(sent[3].host,'heartbeat.example');
 assert.equal(JSON.stringify(sent).includes('secret'),false);
});
test('failed alert delivery cannot acknowledge the transition', async () => {
 const prior={notifiedHealthy:true};
 await assert.rejects(monitorCycle({origin:'https://drvn.example',secret:'secret',alertUrl:'https://alerts.example/hook'},prior,async url=>new Response(null,{status:url.hostname==='drvn.example'?503:500})), /delivery_failed/);
 assert.deepEqual(prior,{notifiedHealthy:true});
});
test('uncertain notification retry retains its identity across persisted cycles', async () => {
 let stored={notifiedHealthy:true};const ids=[];
 const config={origin:'https://drvn.example',secret:'secret',alertUrl:'https://alerts.example/hook'};
 const transport=async (url,init)=>{if(url.hostname==='drvn.example')return new Response(null,{status:503});ids.push(JSON.parse(init.body).notificationId);throw new Error('unknown delivery');};
 for (const now of [10000,20000]) await assert.rejects(monitorCycle(config,stored,transport,now,async state=>{stored={...state};}),/delivery_failed/);
 assert.equal(ids[0],ids[1]);assert.equal(stored.notifiedHealthy,true);
});
