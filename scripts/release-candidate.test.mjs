import {test} from 'node:test';import assert from 'node:assert/strict';
import {REQUIRED_GATES,validateConfiguration,verifyPromotion} from './release-candidate.mjs';
const config={environmentId:'staging',canonicalOrigin:'https://staging.example',supabaseProjectRef:'test-project',paymentMode:'stripe-test',shippingMode:'stub',analyticsEnabled:false,searchEnabled:false,betaRequired:true,operator:'release-owner'};
const candidate={sourceSha:'a'.repeat(40),buildDigest:'b'.repeat(64),migrationsDigest:'c'.repeat(64),configuration:config};
const now=Date.parse('2026-09-05T20:00:00Z');
const reports=()=>REQUIRED_GATES.map(gate=>({gate,sourceSha:candidate.sourceSha,buildDigest:candidate.buildDigest,migrationsDigest:candidate.migrationsDigest,environmentId:'staging',passed:true,evidenceDigest:'d'.repeat(64),observedAt:new Date(now).toISOString(),counts:{expected:100,flaky:0,unexpected:0}}));
test('only complete candidate-bound evidence qualifies',()=>{assert.equal(verifyPromotion(candidate,reports(),now).eligible,true);});
test('rejects missing, duplicated, failed, stale, future and different candidate reports',()=>{
 for(const change of [r=>r.pop(),r=>r.push(r[0]),r=>r[0].passed=false,r=>r[0].sourceSha='e'.repeat(40),r=>r[0].buildDigest='e'.repeat(64),r=>r[0].environmentId='other',r=>r[0].observedAt='2025-01-01',r=>r[0].observedAt='2027-01-01',r=>r.find(x=>x.gate==='browser-first-attempt').counts.flaky=1]){const r=reports();change(r);assert.throws(()=>verifyPromotion(candidate,r,now),/blocked/);}
});
test('configuration excludes secrets, live providers and ambiguous origins',()=>{
 for(const patch of [{STRIPE_SECRET_KEY:'secret'},{paymentMode:'stripe-live'},{betaRequired:false},{canonicalOrigin:'https://user:secret@example.com'},{canonicalOrigin:'https://example.com/path'}])assert.throws(()=>validateConfiguration({...config,...patch}));
});

test('evidence bytes must match and remain within the report directory',async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {createHash}=await import('node:crypto');const {verifyEvidenceFiles}=await import('./release-candidate.mjs');
 const dir=mkdtempSync(join(tmpdir(),'drvn-evidence-'));
 try {writeFileSync(join(dir,'proof.txt'),'pass');const report={evidencePath:'proof.txt',evidenceDigest:createHash('sha256').update('pass').digest('hex')};verifyEvidenceFiles([report],dir);writeFileSync(join(dir,'proof.txt'),'changed');assert.throws(()=>verifyEvidenceFiles([report],dir),/mismatch/);assert.throws(()=>verifyEvidenceFiles([{...report,evidencePath:'..'}],dir),/within/);}finally{rmSync(dir,{recursive:true,force:true});}
});
