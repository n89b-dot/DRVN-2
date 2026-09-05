// Read-only local baseline. This deliberately cannot target hosted services.
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
const origin=process.env.DRVN_LOAD_ORIGIN??'http://127.0.0.1:3000';
if(!/^http:\/\/127\.0\.0\.1:(3000|3001)$/.test(origin))throw new Error('Load drill requires an isolated loopback DRVN build on port 3000 or 3001');
const output=process.argv[2];
if(!output)throw new Error('Usage: node scripts/local-load-drill.mjs REPORT.json');
const paths=['/','/explore','/login'];
const percentile=(values,p)=>values[Math.min(values.length-1,Math.ceil(values.length*p)-1)]??null;
const stages=[];
for(const concurrency of [1,5,20]){
 const start=performance.now();const end=start+15_000;const observations=[];
 await Promise.all(Array.from({length:concurrency},async(_,worker)=>{
  let request=worker;
  while(performance.now()<end){
   const path=paths[request++%paths.length];const begun=performance.now();
   try{
    const response=await fetch(origin+path,{redirect:'error',signal:AbortSignal.timeout(10_000)});
    await response.arrayBuffer();
    observations.push({path,ms:performance.now()-begun,ok:response.status===200,status:response.status});
   }catch{observations.push({path,ms:performance.now()-begun,ok:false,status:0});}
  }
 }));
 const elapsedMs=performance.now()-start;
 const routes=paths.map(path=>{
  const rows=observations.filter(row=>row.path===path);const times=rows.map(row=>row.ms).sort((a,b)=>a-b);
  return {path,requests:rows.length,errors:rows.filter(row=>!row.ok).length,p50Ms:percentile(times,.5),p95Ms:percentile(times,.95),p99Ms:percentile(times,.99)};
 });
 stages.push({concurrency,elapsedMs,requests:observations.length,requestsPerSecond:observations.length/(elapsedMs/1000),routes});
 console.log(`Completed local concurrency ${concurrency}: ${observations.length} requests`);
}
const report={observedAt:new Date().toISOString(),scope:'Local public read baseline; no checkout, hosted capacity, soak or accepted SLO claim',origin,stages};
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
if(stages.some(stage=>stage.routes.some(route=>route.errors)))process.exitCode=1;
