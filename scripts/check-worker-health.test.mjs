import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWorkerHealth, monitorCycle, REQUIRED_CONFIG, REQUIRED_FAMILIES, REQUIRED_JOBS } from './check-worker-health.mjs';
const healthy = { families: REQUIRED_FAMILIES.map(family => ({ family, stale: false })), jobs: REQUIRED_JOBS.map(job => ({ job, stale: false })), queues: [], config: { scheduler: 'ok', runHistory: 'ok', pgNet: 'ok', workerUrl: 'ok', workerSecret: 'ok' }, problems: [] };
const stoppedJob = () => ({ ...healthy, jobs: healthy.jobs.map(j => j.job === 'drvn-media-gc' ? { ...j, stale: true, reason: 'overdue', last_success: '2026-11-05T03:17:00.000Z' } : j) });
test('accepts complete healthy state and keeps the bearer out of results', async () => {
 const result = await checkWorkerHealth('https://drvn.example', 'secret', async (_url, init) => { assert.equal(init.redirect, 'error'); return Response.json(healthy); });
 assert.deepEqual(result, { healthy: true, families: 21, jobs: 21 });
});
test('fails on unavailable, malformed, stale and exhausted health', async () => {
 for (const response of [new Response(null, { status: 503 }), new Response(null, { status: 500 }), Response.json({}), Response.json({ ...healthy, families: [{ stale: true }] }), Response.json({ ...healthy, queues: [{ status: 'failed' }] }), Response.json({ ...healthy, jobs: undefined }), Response.json({ error: 'Health data incomplete' }, { status: 503 })]) {
  await assert.rejects(checkWorkerHealth('https://drvn.example', 'secret', async () => response));
 }
});
// Plan 2 item A5 (R-email): the app marks the digest job and family `disabled`
// while no email provider is configured. The monitor still requires both rows
// to be present, and does not page for them; the same rows without the mark page.
test('a job and family the app marks disabled are present but not paged; unmarked, they page (R-email)', async () => {
 const stale = (disabled) => ({ ...healthy,
  jobs: healthy.jobs.map(j => j.job === 'drvn-saved-search-digests' ? { ...j, stale: !disabled, disabled: disabled || undefined, reason: 'overdue' } : j),
  families: healthy.families.map(f => f.family === 'savedSearchDigests' ? { ...f, stale: !disabled, disabled: disabled || undefined, reason: 'failing' } : f) });
 const marked = await checkWorkerHealth('https://drvn.example', 'secret', async () => Response.json(stale(true)));
 assert.deepEqual(marked, { healthy: true, families: 21, jobs: 21 });
 await assert.rejects(checkWorkerHealth('https://drvn.example', 'secret', async () => Response.json(stale(false), { status: 503 })), error => {
  assert.equal(error.message, 'worker_health_unhealthy');
  assert.deepEqual(error.problems.map(p => `${p.area}:${p.name}:${p.reason}`).sort(), ['family:savedSearchDigests:failing', 'job:drvn-saved-search-digests:overdue']);
  return true;
 });
 // A deployment cannot hide a job by dropping it: absent is incomplete, whatever the mark.
 const dropped = { ...stale(true), jobs: stale(true).jobs.filter(j => j.job !== 'drvn-saved-search-digests') };
 await assert.rejects(checkWorkerHealth('https://drvn.example', 'secret', async () => Response.json(dropped)), /incomplete/);
});
test('never sends a bearer over remote HTTP', async () => {
 await assert.rejects(checkWorkerHealth('http://drvn.example', 'secret', async () => { throw new Error('must not fetch'); }), /HTTPS/);
});

test('rejects duplicated inventory and transport errors without leaking request secrets', async () => {
 await assert.rejects(checkWorkerHealth('https://drvn.example', 'secret', async () => Response.json({...healthy,families:Array.from({length:20},()=>({family:'alerts',stale:false}))})), /incomplete/);
 await assert.rejects(checkWorkerHealth('https://drvn.example', 'secret', async () => {throw new Error('secret in upstream error');}), error => !error.message.includes('secret'));
});
test('a job or family missing from the snapshot is named, not just "incomplete"', async () => {
 const withoutAgent = { ...healthy, families: healthy.families.filter(f => f.family !== 'agent'), jobs: healthy.jobs.filter(j => j.job !== 'drvn-explore-trending') };
 await assert.rejects(checkWorkerHealth('https://drvn.example', 'secret', async () => Response.json(withoutAgent, { status: 503 })), error => {
  assert.equal(error.message, 'worker_health_incomplete');
  assert.deepEqual(error.problems.map(p => `${p.area}:${p.name}`), ['family:agent', 'job:drvn-explore-trending']);
  return true;
 });
});
test('names each problem the unhealthy body carries, and only names, reasons, counts and times', async () => {
 const body = { ...stoppedJob(), queues: [{ kind: 'webhooks', status: 'retrying', overdue: true, count: 3, oldest: '2026-11-07T08:00:00.000Z', attempts_max: 6 }], config: { ...healthy.config, workerSecret: 'mismatch' },
  problems: [{ area: 'queue', name: 'webhooks/retrying', reason: 'overdue', count: 3, payload: { email: 'buyer@example.test' } }, { area: 'family', name: '<script>', reason: 'stale' }] };
 await assert.rejects(checkWorkerHealth('https://drvn.example', 'secret', async () => Response.json(body, { status: 503 })), error => {
  assert.equal(error.message, 'worker_health_unhealthy');
  assert.deepEqual(error.problems.map(p => `${p.area}:${p.name}:${p.reason}`).sort(), ['config:workerSecret:mismatch', 'job:drvn-media-gc:overdue', 'queue:webhooks/retrying:overdue']);
  assert.equal(JSON.stringify(error.problems).includes('buyer@'), false);
  assert.equal(error.problems.find(p => p.area === 'queue').attempts, 6);
  return true;
 });
});
test('a deliberately stopped job pages once after confirmation, names the job, then recovers (fake destination)', async () => {
 const sent=[];let body=stoppedJob();
 const config={origin:'https://drvn.example',secret:'secret',alertUrl:'https://alerts.example/hook',heartbeatUrl:'https://heartbeat.example/ping'};
 const transport=async (url,init)=>{if(url.hostname==='drvn.example') return Response.json(body,{status:body===healthy?200:503}); sent.push({host:url.hostname,body:init.body&&JSON.parse(init.body)});return new Response(null,{status:204});};
 let result=await monitorCycle(config,{notifiedHealthy:true},transport,10000);
 assert.equal(sent.length,0,'one failing check is not yet an incident');
 result=await monitorCycle(config,result.state,transport,70000);
 assert.equal(sent[0].body.kind,'unhealthy');
 assert.match(sent[0].body.summary,/job drvn-media-gc: overdue/);
 assert.equal(sent[0].body.runbook,'docs/production-runbook.md §9b');
 assert.deepEqual(sent[0].body.problems.map(p=>p.name),['drvn-media-gc']);
 result=await monitorCycle(config,result.state,transport,130000);
 assert.equal(sent.length,1,'the same problem is not paged again before the reminder');
 body={...stoppedJob(),families:healthy.families.map(f=>f.family==='media'?{...f,stale:true,reason:'overdue'}:f)};
 result=await monitorCycle(config,result.state,transport,190000);
 assert.equal(sent[1].body.kind,'worsened');
 body=healthy;
 result=await monitorCycle(config,result.state,transport,250000);
 assert.equal(sent[2].body.kind,'recovered');
 assert.equal(sent[3].host,'heartbeat.example');
 assert.equal(result.state.notifiedFingerprint,undefined);
});
test('notifies failure once, escalates, and notifies recovery; health heartbeat is independent', async () => {
 const sent=[];let failing=true;
 const config={origin:'https://drvn.example',secret:'secret',alertUrl:'https://alerts.example/hook',heartbeatUrl:'https://heartbeat.example/ping',escalateAfterMs:1000,confirmChecks:1};
 const transport=async (url,init)=>{if(url.hostname==='drvn.example') return failing?new Response(null,{status:503}):Response.json(healthy); sent.push({host:url.hostname,body:init.body&&JSON.parse(init.body)});return new Response(null,{status:204});};
 let result=await monitorCycle(config,{},transport,10000);assert.equal(sent[0].body.kind,'unhealthy');
 result=await monitorCycle(config,result.state,transport,10500);assert.equal(sent.length,1);
 result=await monitorCycle(config,result.state,transport,11001);assert.equal(sent[1].body.kind,'still_unhealthy');
 failing=false;await monitorCycle(config,result.state,transport,12000);assert.equal(sent[2].body.kind,'recovered');assert.equal(sent[3].host,'heartbeat.example');
 assert.equal(JSON.stringify(sent).includes('secret'),false);
});
test('a silence window suppresses paging, and an incident still open afterwards pages then', async () => {
 const sent=[];
 const config={origin:'https://drvn.example',secret:'secret',alertUrl:'https://alerts.example/hook',confirmChecks:1,silenceUntil:new Date(60000).toISOString()};
 const transport=async (url,init)=>{if(url.hostname==='drvn.example') return Response.json(stoppedJob(),{status:503}); sent.push(JSON.parse(init.body));return new Response(null,{status:204});};
 let result=await monitorCycle(config,{notifiedHealthy:true},transport,10000);
 assert.equal(sent.length,0);assert.equal(result.state.suppressedKind,'unhealthy');
 result=await monitorCycle(config,result.state,transport,61000);
 assert.equal(sent[0].kind,'unhealthy');assert.equal(result.state.suppressedKind,undefined);
});
test('failed alert delivery cannot acknowledge the transition', async () => {
 const prior={notifiedHealthy:true};
 await assert.rejects(monitorCycle({origin:'https://drvn.example',secret:'secret',alertUrl:'https://alerts.example/hook',confirmChecks:1},prior,async url=>new Response(null,{status:url.hostname==='drvn.example'?503:500})), /delivery_failed/);
 assert.deepEqual(prior,{notifiedHealthy:true});
});
test('uncertain notification retry retains its identity across persisted cycles', async () => {
 let stored={notifiedHealthy:true};const ids=[];
 const config={origin:'https://drvn.example',secret:'secret',alertUrl:'https://alerts.example/hook',confirmChecks:1};
 const transport=async (url,init)=>{if(url.hostname==='drvn.example')return new Response(null,{status:503});ids.push(JSON.parse(init.body).notificationId);throw new Error('unknown delivery');};
 for (const now of [10000,20000]) await assert.rejects(monitorCycle(config,stored,transport,now,async state=>{stored={...state};}),/delivery_failed/);
 assert.equal(ids[0],ids[1]);assert.equal(stored.notifiedHealthy,true);
});
test('a body without its configuration checks is never healthy, and sends no heartbeat', async () => {
 const sent=[];
 const transport=async (url)=>{if(url.hostname==='drvn.example'){const rest={...healthy};delete rest.config;return Response.json(rest);} sent.push(url.hostname);return new Response(null,{status:204});};
 await assert.rejects(checkWorkerHealth('https://drvn.example','secret',transport), error => {
  assert.equal(error.message,'worker_health_incomplete');
  assert.deepEqual(error.problems.map(p=>`${p.name}:${p.reason}`),Object.keys(REQUIRED_CONFIG).map(name=>`${name}:missing`));
  return true;
 });
 const {result}=await monitorCycle({origin:'https://drvn.example',secret:'secret',alertUrl:'https://alerts.example/hook',heartbeatUrl:'https://heartbeat.example/ping'},{notifiedHealthy:true},transport,10000);
 assert.equal(result.healthy,false);
 assert.deepEqual(sent,[],'no heartbeat without verified configuration');
});
test('each missing, malformed or failing configuration check is named', async () => {
 const cases=[
  [{ pgNet: undefined }, 'worker_health_incomplete', 'pgNet:missing'],
  [{ scheduler: true }, 'worker_health_incomplete', 'scheduler:malformed'],
  [{ workerUrl: false }, 'worker_health_incomplete', 'workerUrl:malformed'],
  [{ runHistory: 'sometimes' }, 'worker_health_incomplete', 'runHistory:malformed'],
  [{ workerSecret: 'unchecked' }, 'worker_health_unhealthy', 'workerSecret:unchecked'],
  [{ workerUrl: 'invalid' }, 'worker_health_unhealthy', 'workerUrl:invalid'],
 ];
 for (const [change, code, problem] of cases) {
  const config={...healthy.config,...change};
  for (const key of Object.keys(change)) if (change[key]===undefined) delete config[key];
  await assert.rejects(checkWorkerHealth('https://drvn.example','secret',async()=>Response.json({...healthy,config})), error => {
   assert.equal(error.message,code,problem);
   assert.deepEqual(error.problems.map(p=>`${p.name}:${p.reason}`),[problem]);
   return true;
  });
 }
 await assert.rejects(checkWorkerHealth('https://drvn.example','secret',async()=>Response.json({...healthy,config:['ok']})), /incomplete/);
});
