import { createClient } from '@supabase/supabase-js';

/** Enqueue resumable rebuilds; the regular worker owns eligibility and delivery. */
export async function rebuild(entities) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || process.env.DRVN_SEARCH_PROJECT_URL !== url) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and matching DRVN_SEARCH_PROJECT_URL explicitly');
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const entity of entities) {
    const pending = await admin.from('search_rebuilds').select('id,status,cursor').eq('entity', entity).eq('status', 'pending').order('created_at').limit(1).throwOnError();
    let run = pending.data[0];
    if (!run) {
      const created = await admin.from('search_rebuilds').insert({ entity }).select('id,status,cursor').single().throwOnError();
      run = created.data;
    }
    const advanced = await admin.rpc('advance_search_rebuild', { p_run: run.id }).throwOnError();
    console.log(JSON.stringify({ entity, runId: run.id, ...advanced.data }));
  }
  console.log('The search worker resumes pagination and delivery. Completed rebuild pagination does not mean all queued documents have been delivered.');
}
