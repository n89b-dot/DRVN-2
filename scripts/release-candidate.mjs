import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync,writeFileSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,relative,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REQUIRED_GATES=['unit','typecheck','lint','sql','schema-parity','build','browser-first-attempt','stripe-api','hosted-provider','guest-hold-caps','privacy','accessibility','operations','restore-rollback','staging-soak'];
const digest = value => createHash('sha256').update(value).digest('hex');
export function validateConfiguration(config) {
 const allowed=['environmentId','canonicalOrigin','supabaseProjectRef','paymentMode','shippingMode','analyticsEnabled','searchEnabled','guestCheckout','operator'];
 if (!config || Object.keys(config).some(key=>!allowed.includes(key)) || allowed.some(key=>!(key in config))) throw new Error('Candidate configuration must use the exact non-secret field inventory');
 for(const field of ['environmentId','supabaseProjectRef','operator']) if(typeof config[field]!=='string'||!config[field].trim()) throw new Error(`Missing candidate ${field}`);
 const origin=new URL(config.canonicalOrigin);
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Candidate requires a canonical HTTPS origin');
 if(config.paymentMode!=='stripe-test'||!['stub','easypost-test'].includes(config.shippingMode))throw new Error('Staging candidate must use test providers');
 // R-rcconfig (remediation plan B3): the invite-only beta was removed (#126); guest checkout is open with
 // holds capped per device, network and listing (20261107220800), so the candidate declares that, not a beta.
 if(config.guestCheckout!=='capped' || typeof config.analyticsEnabled!=='boolean'||typeof config.searchEnabled!=='boolean')throw new Error('Explicit guest-checkout and optional-provider decisions required');
 return config;
}
function treeFiles(root,base=root) {
 return readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
  const p=join(root,entry.name);if(entry.isSymbolicLink())throw new Error('Candidate build must not contain symlinks');
  return entry.isDirectory()?treeFiles(p,base):[{path:relative(base,p).replaceAll('\\','/'),sha256:digest(readFileSync(p)),bytes:statSync(p).size}];
 });
}
export function captureCandidate(root,config,expectedSourceSha) {
 validateConfiguration(config);
 if(execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'}).trim())throw new Error('Candidate capture requires a clean committed source tree');
 const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 if(sourceSha!==expectedSourceSha)throw new Error('Build source changed or was not verified by the candidate builder');
 const buildRoot=join(root,'.next');
 const buildId=readFileSync(join(buildRoot,'BUILD_ID'),'utf8').trim();
 const files=['server','static'].flatMap(folder=>treeFiles(join(buildRoot,folder)).map(file=>({...file,path:`${folder}/${file.path}`})));
 for(const entry of readdirSync(buildRoot,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(entry.isFile()&&(entry.name.endsWith('.json')||entry.name==='BUILD_ID')){const path=join(buildRoot,entry.name);files.push({path:entry.name,sha256:digest(readFileSync(path)),bytes:statSync(path).size});}}
 const migrations=treeFiles(join(root,'supabase/migrations')).filter(file=>file.path.endsWith('.sql'));
 return {version:1,sourceSha,buildId,buildDigest:digest(JSON.stringify(files)),migrationsDigest:digest(JSON.stringify(migrations)),buildFiles:files,migrations,lockfileDigest:digest(readFileSync(join(root,'package-lock.json'))),nodeVersion:process.version,configuration:config,configurationSource:'operator-declared; hosted observation required',createdAt:new Date().toISOString()};
}
export function verifyEvidenceFiles(reports, directory) {
 const base=realpathSync(directory);
 for(const report of reports) {
  if(typeof report.evidencePath!=='string'||!report.evidencePath)throw new Error('Evidence file path required');
  const path=realpathSync(resolve(base,report.evidencePath));
  const rel=relative(base,path);
  if(rel.startsWith('..')||resolve(base,rel)!==path||!statSync(path).isFile())throw new Error('Evidence must be a file within the report directory');
  if(digest(readFileSync(path))!==report.evidenceDigest)throw new Error('Evidence digest mismatch');
 }
}
export function verifyPromotion(candidate,reports,now=Date.now()) {
 validateConfiguration(candidate.configuration);
 if(!/^[a-f0-9]{40}$/.test(candidate.sourceSha)||!['buildDigest','migrationsDigest'].every(k=>/^[a-f0-9]{64}$/.test(candidate[k])))throw new Error('Invalid candidate identity');
 if(!Array.isArray(reports))throw new Error('Gate reports required');
 const missing=[];
 for(const gate of REQUIRED_GATES){
  const matching=reports.filter(report=>report.gate===gate);
  if(matching.length!==1){missing.push(`${gate}: one unambiguous report required`);continue;}
  const r=matching[0];
  if(r.sourceSha!==candidate.sourceSha||r.buildDigest!==candidate.buildDigest||r.migrationsDigest!==candidate.migrationsDigest||r.environmentId!==candidate.configuration.environmentId||r.passed!==true||!r.evidenceDigest||!/^[a-f0-9]{64}$/.test(r.evidenceDigest)||!Number.isFinite(Date.parse(r.observedAt))||Date.parse(r.observedAt)>now||now-Date.parse(r.observedAt)>7*86400_000)missing.push(`${gate}: failed, stale or mismatched evidence`);
  if(gate==='browser-first-attempt'&&(!r.counts||r.counts.flaky!==0||r.counts.unexpected!==0||r.counts.expected<=0))missing.push(`${gate}: first-attempt proof missing`);
 }
 if(missing.length)throw new Error(`Promotion blocked\n${missing.join('\n')}`);
 return {eligible:true,sourceSha:candidate.sourceSha,buildDigest:candidate.buildDigest,gateCount:REQUIRED_GATES.length};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 try {
  const [command,a,b]=process.argv.slice(2);
  if(command==='build'&&a&&b){const config=validateConfiguration(JSON.parse(readFileSync(a,'utf8')));const sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw new Error('Candidate build requires a clean source tree');execFileSync('npm',['run','build'],{stdio:'inherit'});const manifest=captureCandidate(process.cwd(),config,sourceSha);writeFileSync(resolve(b),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});console.log('Candidate manifest captured; acceptance remains unverified.');}
  else if(command==='verify'&&a&&b){const candidate=JSON.parse(readFileSync(a,'utf8'));const reports=JSON.parse(readFileSync(b,'utf8'));verifyEvidenceFiles(reports,dirname(resolve(b)));console.log(JSON.stringify(verifyPromotion(candidate,reports)));}
  else throw new Error('Usage: release-candidate.mjs build CONFIG OUTPUT | verify CANDIDATE REPORTS');
 } catch(error){console.error(error.message);process.exitCode=1;}
}
