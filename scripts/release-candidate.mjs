import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync,writeFileSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,relative,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REQUIRED_GATES=['unit','typecheck','lint','sql','schema-parity','build','browser-first-attempt','stripe-api','hosted-provider','guest-hold-caps','privacy','accessibility','operations','restore-rollback','staging-soak'];
// 'off' is DRVN Shipping switched off, which is what DRVN launches with
// (docs/release-evidence/launch-configuration.md). A candidate that rehearses
// the launch settings has to be able to say so; before 24 Nov 2026 it could
// only declare a shipping provider.
export const SHIPPING_MODES=['off','stub','easypost-test'];
const digest = value => createHash('sha256').update(value).digest('hex');
export function validateConfiguration(config) {
 const allowed=['environmentId','canonicalOrigin','supabaseProjectRef','paymentMode','shippingMode','analyticsEnabled','searchEnabled','guestCheckout','operator'];
 if (!config || Object.keys(config).some(key=>!allowed.includes(key)) || allowed.some(key=>!(key in config))) throw new Error('Candidate configuration must use the exact non-secret field inventory');
 for(const field of ['environmentId','supabaseProjectRef','operator']) if(typeof config[field]!=='string'||!config[field].trim()) throw new Error(`Missing candidate ${field}`);
 const origin=new URL(config.canonicalOrigin);
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Candidate requires a canonical HTTPS origin');
 if(config.paymentMode!=='stripe-test'||!SHIPPING_MODES.includes(config.shippingMode))throw new Error('Staging candidate must use test providers, or DRVN Shipping off');
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
 const source=sourceDigests(root);
 return {version:1,sourceSha,buildId,buildDigest:digest(JSON.stringify(files)),migrationsDigest:source.migrationsDigest,buildFiles:files,migrations:source.migrations,lockfileDigest:source.lockfileDigest,nodeVersion:process.version,configuration:config,configurationSource:'operator-declared; hosted observation required',createdAt:new Date().toISOString()};
}
// What a checkout says about its own migrations and lockfile: written into a
// candidate when it is built, and worked out again from the tagged commit
// when production deploys it.
export function sourceDigests(root) {
 const migrations=treeFiles(join(root,'supabase/migrations')).filter(file=>file.path.endsWith('.sql'));
 return {migrations,migrationsDigest:digest(JSON.stringify(migrations)),lockfileDigest:digest(readFileSync(join(root,'package-lock.json')))};
}
// N540: variables that must be absent from every hosted environment. The
// operations gate runs `hosted-env` on the host's variable list (for Vercel,
// `vercel env ls production` and `vercel env ls preview` saved to a file); the
// app also refuses to boot with the first one on a hosted deployment.
export const FORBIDDEN_HOSTED_VARIABLES=['PAYMENTS_ALLOW_STUB_IN_PRODUCTION','SHIPPING_ALLOW_STUB_IN_PRODUCTION'];
export function forbiddenHostedVariables(listing) {
 const names=new Set(String(listing).split(/\r?\n/).map(line=>line.trim().split(/\s+/)[0]).filter(Boolean));
 return FORBIDDEN_HOSTED_VARIABLES.filter(name=>names.has(name));
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
// The production deploy's check (.github/workflows/deploy.yml, the 24 Nov 2026
// audit's first finding: the deploy never asked for the 15 gates). The packet
// is the folder docs/release-evidence/candidates/<tag>/ as it stands on main:
// candidate.json, reports.json and the evidence files the reports name.
// `root` is the checkout of the tagged commit, so the packet has to be for
// exactly this source, these migrations and this lockfile. The build digest is
// the staging candidate's and is not compared: production is built again, with
// production's own variables.
// Evidence is fresh as of `taggedAt`, the moment the release tag was made, not
// the moment of the deploy. Making the tag is the sign-off, so the evidence
// must be no older than seven days then and none of it later; and the same tag
// deployed again months on (a rollback, runbook §7a, or a changed variable)
// is not refused because time has passed.
export function verifyRelease(packetDir,root,sha,taggedAt) {
 const read=name=>{try{return JSON.parse(readFileSync(join(packetDir,name),'utf8'));}catch{throw new Error(`Evidence packet has no readable ${name}`);}};
 const candidate=read('candidate.json');const reports=read('reports.json');
 if(!Number.isFinite(taggedAt))throw new Error('The release tag has no readable date');
 if(!candidate||candidate.sourceSha!==sha)throw new Error(`Evidence packet is for commit ${candidate?.sourceSha}, not the tagged commit ${sha}`);
 const source=sourceDigests(root);
 if(candidate.migrationsDigest!==source.migrationsDigest)throw new Error('Evidence packet was built from different migrations than the tagged commit holds');
 if(candidate.lockfileDigest!==source.lockfileDigest)throw new Error('Evidence packet was built from a different lockfile than the tagged commit holds');
 if(!Array.isArray(reports))throw new Error('Gate reports required');
 verifyEvidenceFiles(reports,packetDir);
 return verifyPromotion(candidate,reports,taggedAt);
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 try {
  const [command,a,b,c]=process.argv.slice(2);
  if(command==='build'&&a&&b){const config=validateConfiguration(JSON.parse(readFileSync(a,'utf8')));const sourceSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw new Error('Candidate build requires a clean source tree');execFileSync('npm',['run','build'],{stdio:'inherit'});const manifest=captureCandidate(process.cwd(),config,sourceSha);writeFileSync(resolve(b),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});console.log('Candidate manifest captured; acceptance remains unverified.');}
  else if(command==='verify'&&a&&b){const candidate=JSON.parse(readFileSync(a,'utf8'));const reports=JSON.parse(readFileSync(b,'utf8'));verifyEvidenceFiles(reports,dirname(resolve(b)));console.log(JSON.stringify(verifyPromotion(candidate,reports)));}
  else if(command==='hosted-env'&&a){const found=forbiddenHostedVariables(readFileSync(a,'utf8'));if(found.length)throw new Error(`Hosted environment sets ${found.join(', ')}: remove it (N540)`);console.log(`Hosted environment has none of ${FORBIDDEN_HOSTED_VARIABLES.join(', ')}.`);}
  else if(command==='promote'&&a&&b&&c){console.log(JSON.stringify(verifyRelease(resolve(a),process.cwd(),b,Date.parse(c))));}
  else throw new Error('Usage: release-candidate.mjs build CONFIG OUTPUT | verify CANDIDATE REPORTS | promote PACKET_DIR TAGGED_SHA TAG_DATE | hosted-env VARIABLE_LISTING');
 } catch(error){console.error(error.message);process.exitCode=1;}
}
