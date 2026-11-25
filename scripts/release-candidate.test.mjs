import {test} from 'node:test';import assert from 'node:assert/strict';
import {REQUIRED_GATES,validateConfiguration,verifyPromotion,forbiddenHostedVariables} from './release-candidate.mjs';
const config={environmentId:'staging',canonicalOrigin:'https://staging.example',supabaseProjectRef:'test-project',paymentMode:'stripe-test',shippingMode:'stub',analyticsEnabled:false,searchEnabled:false,guestCheckout:'capped',operator:'release-owner'};
const candidate={sourceSha:'a'.repeat(40),buildDigest:'b'.repeat(64),migrationsDigest:'c'.repeat(64),configuration:config};
const now=Date.parse('2026-09-05T20:00:00Z');
const reports=()=>REQUIRED_GATES.map(gate=>({gate,sourceSha:candidate.sourceSha,buildDigest:candidate.buildDigest,migrationsDigest:candidate.migrationsDigest,environmentId:'staging',passed:true,evidenceDigest:'d'.repeat(64),observedAt:new Date(now).toISOString(),counts:{expected:100,flaky:0,unexpected:0}}));
test('only complete candidate-bound evidence qualifies',()=>{assert.equal(verifyPromotion(candidate,reports(),now).eligible,true);});
test('rejects missing, duplicated, failed, stale, future and different candidate reports',()=>{
 for(const change of [r=>r.pop(),r=>r.push(r[0]),r=>r[0].passed=false,r=>r[0].sourceSha='e'.repeat(40),r=>r[0].buildDigest='e'.repeat(64),r=>r[0].environmentId='other',r=>r[0].observedAt='2025-01-01',r=>r[0].observedAt='2027-01-01',r=>r.find(x=>x.gate==='browser-first-attempt').counts.flaky=1]){const r=reports();change(r);assert.throws(()=>verifyPromotion(candidate,r,now),/blocked/);}
});
test('configuration excludes secrets, live providers and ambiguous origins',()=>{
 for(const patch of [{STRIPE_SECRET_KEY:'secret'},{paymentMode:'stripe-live'},{guestCheckout:'open'},{guestCheckout:undefined},{canonicalOrigin:'https://user:secret@example.com'},{canonicalOrigin:'https://example.com/path'}])assert.throws(()=>validateConfiguration({...config,...patch}));
});

test('evidence bytes must match and remain within the report directory',async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {createHash}=await import('node:crypto');const {verifyEvidenceFiles}=await import('./release-candidate.mjs');
 const dir=mkdtempSync(join(tmpdir(),'drvn-evidence-'));
 try {writeFileSync(join(dir,'proof.txt'),'pass');const report={evidencePath:'proof.txt',evidenceDigest:createHash('sha256').update('pass').digest('hex')};verifyEvidenceFiles([report],dir);writeFileSync(join(dir,'proof.txt'),'changed');assert.throws(()=>verifyEvidenceFiles([report],dir),/mismatch/);assert.throws(()=>verifyEvidenceFiles([{...report,evidencePath:'..'}],dir),/within/);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('R-rcconfig: fifteen gates, guest hold caps in place of the removed invitation boundaries, and no beta field',()=>{
 assert.equal(REQUIRED_GATES.length,15);
 assert.ok(REQUIRED_GATES.includes('guest-hold-caps'));
 assert.ok(!REQUIRED_GATES.includes('invitation-boundaries'));
 assert.equal(validateConfiguration(config).guestCheckout,'capped');
 assert.throws(()=>validateConfiguration({...config,betaRequired:true}),/exact non-secret field inventory/);
 const noGuest={...config};delete noGuest.guestCheckout;assert.throws(()=>validateConfiguration(noGuest),/exact non-secret field inventory/);
});

test('N540: the hosted variable listing may not carry the sandbox payment or shipping override',()=>{
 const listing=['> Environment Variables found for drvn/staging','',' name                     value      environments  created','NEXT_PUBLIC_SITE_URL       Encrypted  Production    2d ago','PAYMENTS_MODE              Encrypted  Production    2d ago'].join('\n');
 assert.deepEqual(forbiddenHostedVariables(listing),[]);
 assert.deepEqual(forbiddenHostedVariables(listing+'\nPAYMENTS_ALLOW_STUB_IN_PRODUCTION  Encrypted  Production  1m ago'),['PAYMENTS_ALLOW_STUB_IN_PRODUCTION']);
 assert.deepEqual(forbiddenHostedVariables('SHIPPING_ALLOW_STUB_IN_PRODUCTION\nPAYMENTS_ALLOW_STUB_IN_PRODUCTION'),['PAYMENTS_ALLOW_STUB_IN_PRODUCTION','SHIPPING_ALLOW_STUB_IN_PRODUCTION']);
 assert.deepEqual(forbiddenHostedVariables('X_PAYMENTS_ALLOW_STUB_IN_PRODUCTION Encrypted'),[]);
});

test('a candidate can declare DRVN Shipping off, the launch setting, and still no live or unknown provider',()=>{
 assert.equal(validateConfiguration({...config,shippingMode:'off'}).shippingMode,'off');
 for(const shippingMode of ['easypost-live','easypost','none',undefined])assert.throws(()=>validateConfiguration({...config,shippingMode}));
 assert.throws(()=>validateConfiguration({...config,shippingMode:'off',paymentMode:'stripe-live'}),/test providers/);
});

test('production deploys a tag only with a complete packet for exactly that commit, fresh when the tag was made',async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {createHash}=await import('node:crypto');const {verifyRelease,sourceDigests}=await import('./release-candidate.mjs');
 const sha256=value=>createHash('sha256').update(value).digest('hex');
 const dir=mkdtempSync(join(tmpdir(),'drvn-release-'));
 try {
  const root=join(dir,'checkout');mkdirSync(join(root,'supabase/migrations'),{recursive:true});
  writeFileSync(join(root,'supabase/migrations/20261124000000_one.sql'),'select 1;');writeFileSync(join(root,'package-lock.json'),'{"lockfileVersion":3}');
  const source=sourceDigests(root);const sha='a'.repeat(40);const taggedAt=Date.parse('2026-12-01T12:00:00Z');
  const write=(change=()=>{})=>{
   const packet=mkdtempSync(join(dir,'packet-'));
   const made={candidate:{sourceSha:sha,buildDigest:'b'.repeat(64),migrationsDigest:source.migrationsDigest,lockfileDigest:source.lockfileDigest,configuration:{...config,shippingMode:'off'}},evidence:{}};
   made.reports=REQUIRED_GATES.map(gate=>{made.evidence[`${gate}.txt`]=`${gate} passed`;return {gate,sourceSha:sha,buildDigest:made.candidate.buildDigest,migrationsDigest:source.migrationsDigest,environmentId:'staging',passed:true,evidencePath:`${gate}.txt`,evidenceDigest:sha256(`${gate} passed`),observedAt:'2026-11-29T12:00:00Z',counts:{expected:100,flaky:0,unexpected:0}};});
   change(made);
   for(const [name,body] of Object.entries(made.evidence))writeFileSync(join(packet,name),body);
   if(made.candidate!==undefined)writeFileSync(join(packet,'candidate.json'),JSON.stringify(made.candidate));
   writeFileSync(join(packet,'reports.json'),JSON.stringify(made.reports));
   return packet;
  };
  const good=write();
  assert.deepEqual(verifyRelease(good,root,sha,taggedAt),{eligible:true,sourceSha:sha,buildDigest:'b'.repeat(64),gateCount:15});
  assert.throws(()=>verifyRelease(good,root,'c'.repeat(40),taggedAt),/not the tagged commit/);
  assert.throws(()=>verifyRelease(good,root,sha,NaN),/no readable date/);
  assert.throws(()=>verifyRelease(join(dir,'absent'),root,sha,taggedAt),/no readable candidate\.json/);
  assert.throws(()=>verifyRelease(write(m=>{m.candidate=undefined;}),root,sha,taggedAt),/no readable candidate\.json/);
  assert.throws(()=>verifyRelease(write(m=>{m.reports.pop();}),root,sha,taggedAt),/staging-soak: one unambiguous report required/);
  assert.throws(()=>verifyRelease(write(m=>{m.reports[0].passed=false;}),root,sha,taggedAt),/blocked/);
  // Older than seven days when the tag was made, and gathered after the tag.
  assert.throws(()=>verifyRelease(write(m=>{m.reports[3].observedAt='2026-11-24T11:59:00Z';}),root,sha,taggedAt),/sql: failed, stale or mismatched/);
  assert.throws(()=>verifyRelease(write(m=>{m.reports[3].observedAt='2026-12-01T12:00:01Z';}),root,sha,taggedAt),/sql: failed, stale or mismatched/);
  assert.throws(()=>verifyRelease(write(m=>{m.evidence['privacy.txt']='edited afterwards';}),root,sha,taggedAt),/digest mismatch/);
  assert.throws(()=>verifyRelease(write(m=>{delete m.evidence['privacy.txt'];}),root,sha,taggedAt),/ENOENT/);
  assert.throws(()=>verifyRelease(write(m=>{m.reports='none';}),root,sha,taggedAt),/Gate reports required/);
  // The tagged commit's own files decide: a packet built before a migration or a dependency changed is refused.
  writeFileSync(join(root,'supabase/migrations/20261125000000_two.sql'),'select 2;');
  assert.throws(()=>verifyRelease(good,root,sha,taggedAt),/different migrations/);
  rmSync(join(root,'supabase/migrations/20261125000000_two.sql'));
  writeFileSync(join(root,'package-lock.json'),'{"lockfileVersion":3,"changed":true}');
  assert.throws(()=>verifyRelease(good,root,sha,taggedAt),/different lockfile/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
