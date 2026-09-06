// Exercise a previous compatible application artifact without reverting schema
// or money state. Only an existing isolated local DRVN database is accepted.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
const [ref, report] = process.argv.slice(2);
if (!ref || !report) throw new Error('Usage: node scripts/local-rollback-rehearsal.mjs COMMIT REPORT.json');
const root=process.cwd();
const commit=execFileSync('git',['rev-parse','--verify',`${ref}^{commit}`],{encoding:'utf8'}).trim();
// Reusing installed dependencies is safe only for an identical lockfile.
const oldLock=execFileSync('git',['show',`${commit}:package-lock.json`]);
if (!oldLock.equals(readFileSync('package-lock.json'))) throw new Error('Rollback dependencies differ; build a separately installed artifact instead');
const env={...process.env};
for(const line of readFileSync('.env.test.local','utf8').split('\n')){
 const match=/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
 if(match)env[match[1]]=match[2].replace(/^(["'])(.*)\1$/,'$2');
}
if(env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321'||env.E2E_TEST_PROJECT_REF!=='local-drvn-remediation')throw new Error('Rollback rehearsal requires the isolated local DRVN stack');
// No real provider or external telemetry dispatch is needed for this rehearsal.
for(const key of Object.keys(env)) if(/STRIPE|EASYPOST|ANTHROPIC|SENTRY|POSTHOG|TYPESENSE/.test(key))delete env[key];
Object.assign(env,{PAYMENTS_MODE:'stub',PAYMENTS_ALLOW_STUB_IN_PRODUCTION:'true',SHIPPING_MODE:'stub',SHIPPING_ALLOW_STUB_IN_PRODUCTION:'true',NEXT_PUBLIC_SITE_URL:'http://127.0.0.1:3001',E2E_BASE_URL:'http://127.0.0.1:3001'});
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(3001,'127.0.0.1',()=>probe.close(resolve));});
const scratch=mkdtempSync(path.join(tmpdir(),'drvn-rollback-'));
const log=path.join(tmpdir(),`drvn-rollback-${commit}.log`);const logFd=openSync(log,'w',0o600);
let server;
const started=Date.now();
const run=(command,args)=>new Promise((resolve,reject)=>{
 const child=spawn(command,args,{cwd:scratch,env,stdio:['ignore',logFd,logFd]});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${command} exited ${code}; inspect ${log}`)));
});
try{
 const archive=path.join(scratch,'rollback-source.tar');
 execFileSync('git',['archive','--output',archive,commit]);
 execFileSync('tar',['-xf',archive,'-C',scratch]);
 rmSync(archive);
 // A real copy is required: Turbopack rejects external node_modules symlinks.
 execFileSync('cp',[process.platform==='darwin'?'-cR':'-a',path.join(root,'node_modules'),path.join(scratch,'node_modules')]);
 // Rehearse prior queued-work handlers against the current local schema using
 // their isolated, synthetic crash/retry fixtures before serving the old app.
 const recoverySuites=['notification-read','export','deletion','dispute','social-consistency','privacy-completion'];
 await run('npm',['exec','--','vitest','run','--config','vitest.operations.config.ts',...recoverySuites.map(name=>`tests/operations/${name}.test.ts`)]);
 await run('npm',['run','build']);
 server=spawn(process.execPath,[path.join(scratch,'node_modules/next/dist/bin/next'),'start','-p','3001','-H','127.0.0.1'],{cwd:scratch,env,stdio:['ignore',logFd,logFd]});
 let ready=false;
 for(let attempt=0;attempt<60;attempt++){
  if(server.exitCode!==null)throw new Error('Rollback server exited before readiness');
  try{if((await fetch('http://127.0.0.1:3001/login',{signal:AbortSignal.timeout(2000)})).status===200){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(!ready)throw new Error('Rollback build failed readiness');
 const results=[];
 for(const route of ['/','/login','/marketplace','/explore']){
  const begun=Date.now();const response=await fetch('http://127.0.0.1:3001'+route,{redirect:'manual',signal:AbortSignal.timeout(10000)});const body=await response.text();
  if(response.status!==200||!body.includes('<html'))throw new Error(`Rollback route ${route} failed (${response.status})`);
  results.push({route,status:response.status,elapsedMs:Date.now()-begun});
 }
 const protectedResponse=await fetch('http://127.0.0.1:3001/admin',{redirect:'manual',signal:AbortSignal.timeout(10000)});
 const protectedBody=await protectedResponse.text();
 if(protectedResponse.status!==404||protectedBody.includes('Console - DRVN'))throw new Error(`Rollback anonymous admin boundary failed (${protectedResponse.status})`);
 writeFileSync(report,JSON.stringify({observedAt:new Date().toISOString(),scope:'Previous application artifact and six synthetic queued-work/recovery suites against current local schema; no schema rollback or external financial dispatch; hosted provider compatibility still requires staging',rollbackCommit:commit,dependencyLockSha256:createHash('sha256').update(oldLock).digest('hex'),elapsedSeconds:Math.round((Date.now()-started)/1000),routes:results,anonymousAdminDenied:true,recoverySuites,queuedWorkCompatibility:'passed',result:'passed'},null,2)+'\n');
 console.log(`Local rollback artifact rehearsal passed: ${report}`);
}finally{
 if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
 closeSync(logFd);rmSync(scratch,{recursive:true,force:true});
}
