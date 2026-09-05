// Capture a stable ID-only index inventory, then enqueue at most 100 canonical
// checks per invocation. Workers remove missing/private documents using current DB state.
import { createClient } from '@supabase/supabase-js';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
const [mode, directory] = process.argv.slice(2);
if (!['inventory', 'apply'].includes(mode) || !directory) throw new Error('Usage: node scripts/reconcile-search.mjs inventory|apply secure-directory');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, engine = process.env.TYPESENSE_URL;
if (!url || !engine || !process.env.SUPABASE_SECRET_KEY || !process.env.TYPESENSE_API_KEY || process.env.DRVN_SEARCH_PROJECT_URL !== url || process.env.DRVN_SEARCH_ENGINE_URL !== engine) throw new Error('Explicit matching database and engine targets and service credentials required');
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const headers = { 'X-TYPESENSE-API-KEY': process.env.TYPESENSE_API_KEY };
mkdirSync(directory, { recursive: true, mode: 0o700 });
const manifestPath = join(directory, 'manifest.json');
const save = manifest => { writeFileSync(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2), { mode: 0o600 }); renameSync(`${manifestPath}.tmp`, manifestPath); };
const collections = { listing: 'drvn-listings', car: 'drvn-cars', profile: 'drvn-profiles', update: 'drvn-updates' };
if (mode === 'inventory') {
  if (existsSync(manifestPath)) throw new Error('Use a new directory for a new inventory; existing progress is preserved');
  const manifest = { project: url, engine, collections: [] };
  for (const [entity, name] of Object.entries(collections)) {
    const response = await fetch(`${engine}/collections/${name}/documents/export?include_fields=id`, { headers, signal: AbortSignal.timeout(60000), redirect: 'error' });
    if (!response.ok || !response.body) throw new Error(`Index inventory failed: ${response.status}`);
    let bytes = 0;
    const cap = new Transform({ transform(chunk, _encoding, next) { bytes += chunk.length; next(bytes > 512 * 1024 * 1024 ? new Error('Inventory exceeds 512 MiB safety budget') : null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), cap, createWriteStream(join(directory, `${entity}.jsonl`), { mode: 0o600 }));
    manifest.collections.push({ entity, cursor: 0, completed: false });
  }
  save(manifest); console.log('Saved ID-only search inventory; no index documents changed.');
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.project !== url || manifest.engine !== engine) throw new Error('Inventory target mismatch');
  let queued = 0;
  for (const entry of manifest.collections) {
    if (!(entry.entity in collections) || !Number.isSafeInteger(entry.cursor) || entry.cursor < 0) throw new Error('Invalid inventory checkpoint');
    if (entry.completed || queued >= 100) continue;
    const input = createReadStream(join(directory, `${entry.entity}.jsonl`));
    const lines = createInterface({ input, crlfDelay: Infinity });
    let position = 0, stopped = false;
    try {
      for await (const line of lines) {
        if (position++ < entry.cursor) continue;
        if (queued >= 100) { stopped = true; break; }
        const id = JSON.parse(line).id;
        if (typeof id !== 'string') throw new Error('Invalid index identity');
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
          await admin.rpc('enqueue_search_document', { p_entity: entry.entity, p_id: id }).throwOnError();
        } else {
          // Canonical DRVN IDs are lowercase UUIDs; no database row can own this ID.
          const deleted = await fetch(`${engine}/collections/${collections[entry.entity]}/documents/${encodeURIComponent(id)}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(10000), redirect: 'error' });
          if (!deleted.ok && deleted.status !== 404) throw new Error(`Invalid index ID cleanup failed: ${deleted.status}`);
        }
        entry.cursor = position; queued++; save(manifest);
      }
      if (!stopped) { entry.completed = true; save(manifest); }
    } finally { lines.close(); input.destroy(); }
  }
  console.log(JSON.stringify({ queued, inventoryCompleted: manifest.collections.every(entry => entry.completed) }));
}
