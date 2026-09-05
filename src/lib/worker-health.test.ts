import {expect,it} from 'vitest';import {WORKER_FAMILIES,evaluateWorkerHealth} from './worker-health';
const config={searchEnabled:true,analyticsEnabled:true};
const snapshot=()=>({families:WORKER_FAMILIES.map(family=>({family,stale:false})),queues:[] as {kind:string;status:string;overdue:boolean}[]});
it('does not mistake duplicate or malformed families for full coverage',()=>{
 const s=snapshot();s.families[1]=s.families[0];expect(()=>evaluateWorkerHealth(s,config)).toThrow('Incomplete');
});
it('surfaces runnable backlog, held recovery, and family failure',()=>{
 for(const q of [{kind:'refunds',status:'provider_pending',overdue:true},{kind:'financial_recovery',status:'open',overdue:true},{kind:'transfers',status:'processing',overdue:true}]){const s=snapshot();s.queues.push(q);expect(evaluateWorkerHealth(s,config).unhealthy).toBe(true);}
});
it('explicitly disables only optional configured-off work',()=>{
 const s=snapshot();s.families.find(f=>f.family==='analytics')!.stale=true;s.queues.push({kind:'analytics',status:'failed',overdue:true});
 expect(evaluateWorkerHealth(s,{...config,analyticsEnabled:false}).unhealthy).toBe(false);
 s.queues.push({kind:'financial_recovery',status:'open',overdue:true});expect(evaluateWorkerHealth(s,{searchEnabled:false,analyticsEnabled:false}).unhealthy).toBe(true);
});
