const fs = require('fs');
const Module = require('module');
const path = require('path');
const assert = require('node:assert/strict');
const ts = require(path.join(process.cwd(), 'node_modules/typescript'));
function load(file, mocks) {
 const m = new Module(path.resolve(file));
 m.filename = path.resolve(file);
 m.require = id => Object.prototype.hasOwnProperty.call(mocks,id) ? mocks[id] : require(id);
 m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m.filename);
 return m.exports;
}
(async()=>{
 let captures=0,inserts=0;
 const s=load('src/lib/payments/settlement.ts',{'./refunds':{},'@/lib/supabase/admin':{},'@/lib/monitoring':{reportError(){}},'@/lib/analytics':{capture(){captures++}},'@/lib/admin/alerts':{}});
 const intent={id:'pi_review',metadata:{order_id:'order-review',buyer_id:'buyer-review'},latest_charge:'ch_review'};
 function admin(status,insertError){return {rpc:async()=>({data:{applied:false,status,reason:'order already settled'},error:null}),from(table){if(table==='orders')return {select(){return this},eq(){return this},maybeSingle:async()=>({data:{id:'order-review',seller_id:'seller-review',status,total_cents:10000,platform_fee_cents:500,currency:'USD',transfer_reference:null}})}; if(table==='transfer_intents')return {insert:async()=>{inserts++;return {error:insertError}}};throw Error(table)}}}
 const late=await s.settleIntent(admin('cancelled',null),intent,true);
 assert.equal(late,true);assert.equal(captures,1);assert.equal(inserts,0);
 console.log('CONFIRMED: cancelled order + successful Stripe intent returns settlement success; emits purchase_completed; no transfer intent.');
 const lost=await s.settleIntent(admin('paid',{code:'08006',message:'simulated database write failure'}),intent,true);
 assert.equal(lost,true);assert.equal(inserts,1);
 console.log('CONFIRMED: transfer-intent insert failure is swallowed; settlement still returns success.');
 const a=load('src/lib/admin/audit.ts',{'@/lib/supabase/admin':{},'@/lib/monitoring':{reportError(){}},'./capabilities':{capabilityFor(){return {}}}});
 let changed=false;
 await assert.rejects(()=>a.auditedAction({rpc:async()=>({error:null}),from:()=>({insert:async()=>({error:{message:'simulated audit outage'}})})},{actorId:'admin-review',action:'order.force_refund',subjectType:'order',subjectId:'order-review',reason:'Review probe'},async()=>{changed=true;return {ok:true}}),/action aborted/);
 assert.equal(changed,true);
 console.log('CONFIRMED: admin mutation remains applied when audit insert fails, despite action-aborted error.');
 console.log('These are isolated control-flow probes with mocked dependencies; no database or payment API was contacted.');
})().catch(e=>{console.error(e);process.exitCode=1});
