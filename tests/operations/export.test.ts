import {admin} from './environment';
import {expect,it} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {processAccountExports,purgeAccountExportsForUser,purgeExpiredAccountExports} from '@/lib/account-export-worker';
import {ACCOUNT_EXPORT_CONTRACT_VERSION,ACCOUNT_EXPORT_SECTIONS} from '@/lib/account-export-contract';
const untypedAdmin=admin as unknown as SupabaseClient;
it('finishes every declared export section through bounded durable worker runs',async()=>{
 const created=await admin.auth.admin.createUser({email:`export-${crypto.randomUUID()}@example.test`,email_confirm:true});
 if(created.error)throw created.error;const uid=created.data.user.id;let jobId='';
 try {
  const request=await admin.from('account_export_requests').insert({user_id:uid,contract_version:ACCOUNT_EXPORT_CONTRACT_VERSION}).select('id').single().throwOnError();
  const job=await admin.from('remediation_jobs').insert({kind:'account_export',dedup_key:`export:${request.data.id}`,payload:{request_id:request.data.id,user_id:uid},next_attempt_at:'2000-01-01'}).select('id').single().throwOnError();jobId=job.data.id;
  for(let run=0;run<12;run++){await processAccountExports();const state=await admin.from('account_export_requests').select('status').eq('id',request.data.id).single().throwOnError();if(state.data.status==='completed')break;}
  const result=await admin.from('account_export_requests').select('status,manifest').eq('id',request.data.id).single().throwOnError();expect(result.data.status).toBe('completed');
  const parts=await admin.from('account_export_parts').select('section_key,object_path').eq('request_id',request.data.id).throwOnError();
  expect(parts.data.map(p=>p.section_key)).toEqual(expect.arrayContaining(ACCOUNT_EXPORT_SECTIONS.map(s=>s.key)));
  const manifest=parts.data.find(p=>p.section_key==='manifest')!;
  const stored=await admin.storage.from('account-exports').download(manifest.object_path);expect(stored.error).toBeNull();expect(JSON.parse(await stored.data!.text()).requester.id).toBe(uid);
  const orphan=`${uid}/${request.data.id}/unregistered/crashed-upload`;
  await admin.storage.from('account-exports').upload(orphan,new TextEncoder().encode('orphan'),{contentType:'application/json'});
  const newer=await admin.from('account_export_requests').insert({user_id:uid,contract_version:ACCOUNT_EXPORT_CONTRACT_VERSION,status:'completed'}).select('id').single().throwOnError();
  const newerPath=`${uid}/${newer.data.id}/keep/part`;
  await admin.storage.from('account-exports').upload(newerPath,new TextEncoder().encode('keep'),{contentType:'application/json'});
  await admin.from('account_export_requests').update({expires_at:'2000-01-01'}).eq('id',request.data.id).throwOnError();
  await purgeExpiredAccountExports();
  expect((await admin.storage.from('account-exports').download(orphan)).error).not.toBeNull();
  expect((await admin.storage.from('account-exports').download(manifest.object_path)).error).not.toBeNull();
  expect((await admin.storage.from('account-exports').download(newerPath)).error).toBeNull();
  expect((await untypedAdmin.from('account_export_requests').select('purged_at').eq('id',request.data.id).single().throwOnError()).data.purged_at).not.toBeNull();

  // A crash can upload after an earlier successful sweep. The periodic bounded
  // re-sweep must remove that late object without touching a newer package.
  const lateOrphan=`${uid}/${request.data.id}/unregistered/late-upload`;
  await admin.storage.from('account-exports').upload(lateOrphan,new TextEncoder().encode('late'),{contentType:'application/json'});
  await untypedAdmin.from('account_export_requests').update({purged_at:'2000-01-01',last_purge_attempt_at:'2000-01-01'}).eq('id',request.data.id).throwOnError();
  await purgeExpiredAccountExports();
  expect((await admin.storage.from('account-exports').download(lateOrphan)).error).not.toBeNull();
  expect((await admin.storage.from('account-exports').download(newerPath)).error).toBeNull();

  // This is the durable state left by a failed purge attempt. The cooldown
  // prevents a hot loop; once due, the package is retried and completed.
  const retry=await untypedAdmin.from('account_export_requests').insert({user_id:uid,contract_version:ACCOUNT_EXPORT_CONTRACT_VERSION,status:'expired',expires_at:'2000-01-01',last_purge_attempt_at:new Date().toISOString()}).select('id').single().throwOnError();
  const retryPath=`${uid}/${retry.data.id}/unregistered/retry-upload`;
  await admin.storage.from('account-exports').upload(retryPath,new TextEncoder().encode('retry'),{contentType:'application/json'});
  await purgeExpiredAccountExports();
  expect((await admin.storage.from('account-exports').download(retryPath)).error).toBeNull();
  await untypedAdmin.from('account_export_requests').update({last_purge_attempt_at:'2000-01-01'}).eq('id',retry.data.id).throwOnError();
  await purgeExpiredAccountExports();
  expect((await admin.storage.from('account-exports').download(retryPath)).error).not.toBeNull();
  expect((await untypedAdmin.from('account_export_requests').select('purged_at').eq('id',retry.data.id).single().throwOnError()).data.purged_at).not.toBeNull();
 }finally{await purgeAccountExportsForUser(uid);if(jobId)await admin.from('remediation_jobs').delete().eq('id',jobId).throwOnError();await admin.auth.admin.deleteUser(uid);}
});
