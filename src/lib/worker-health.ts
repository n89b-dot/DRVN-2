export const WORKER_FAMILIES = ['expiries','captures','transfers','transferReconciliation','refunds','labelVoids','returns','disputes','alerts','receipts','analytics','search','deletions','savedSearches','media','listingImports'];
type Family={family:string;stale:boolean;disabled?:boolean};
type Queue={kind:string;status:string;overdue?:boolean;disabled?:boolean};
export function evaluateWorkerHealth(value:unknown,config:{searchEnabled:boolean;analyticsEnabled:boolean}) {
  const health=value as {families?:Family[];queues?:Queue[]}|null;
  if(!health||!Array.isArray(health.families)||!Array.isArray(health.queues)||new Set(health.families.map(f=>f?.family)).size!==health.families.length||WORKER_FAMILIES.some(name=>!health.families?.some(f=>f?.family===name))||health.families.some(f=>!f||typeof f.stale!=='boolean')||health.queues.some(q=>!q||typeof q.kind!=='string'||typeof q.status!=='string'||typeof q.overdue!=='boolean'))throw new Error('Incomplete worker health contract');
  const disabled=new Set<string>();if(!config.searchEnabled)disabled.add('search');if(!config.analyticsEnabled)disabled.add('analytics');
  const families=health.families.map(f=>disabled.has(f.family)?{...f,stale:false,disabled:true}:f);
  const queues=health.queues.map(q=>disabled.has(q.kind)?{...q,disabled:true}:q);
  return {families,queues,unhealthy:families.some(f=>f.stale)||queues.some(q=>!q.disabled&&(q.overdue||q.status==='failed'||q.kind==='financial_recovery'))};
}
