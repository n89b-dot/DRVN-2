// Full Explore search reindex (brief §28): rebuilds the drvn-cars,
// drvn-updates and drvn-profiles Typesense collections from Postgres — the
// canonical truth. Only eligible material is exported (public cars, published
// posts on public cars, unsuspended named profiles), so the index never holds
// anything the RPCs wouldn't return. No-ops loudly without
// TYPESENSE_URL/TYPESENSE_API_KEY. Per-object sync afterwards is handled by
// syncCarToSearch / syncUpdateToSearch / syncProfileToSearch
// (src/lib/explore/search/indexing.ts). Listings: scripts/reindex-search.mjs.
// Usage: node scripts/reindex-explore.mjs
import { readFileSync } from "node:fs";
import { Client } from "pg";

const env = readFileSync(".env.local", "utf8");
const get = (name) => process.env[name] ?? env.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
const TS_URL = get("TYPESENSE_URL");
const TS_KEY = get("TYPESENSE_API_KEY");
if (!TS_URL || !TS_KEY) {
  console.log("TYPESENSE_URL / TYPESENSE_API_KEY not configured — nothing to reindex (Postgres search remains active).");
  process.exit(0);
}
const pwd = get("SUPABASE_DB_PASSWORD");
const ref = env.match(/^NEXT_PUBLIC_SUPABASE_URL=https:\/\/([a-z0-9]+)\.supabase\.co/m)?.[1];

const headers = { "X-TYPESENSE-API-KEY": TS_KEY, "Content-Type": "application/json" };

// Keep in step with EXPLORE_COLLECTION_SCHEMAS (src/lib/explore/search/typesense.ts).
const SCHEMAS = [
  {
    name: "drvn-cars",
    fields: [
      { name: "name", type: "string" },
      { name: "vehicle", type: "string" },
      { name: "tags", type: "string[]" },
      { name: "about", type: "string" },
      { name: "mods", type: "string" },
      { name: "created_at_unix", type: "int64" },
    ],
    default_sorting_field: "created_at_unix",
  },
  {
    name: "drvn-updates",
    fields: [
      { name: "title", type: "string" },
      { name: "intro", type: "string" },
      { name: "body_text", type: "string" },
      { name: "vehicle", type: "string" },
      { name: "published_at_unix", type: "int64" },
    ],
    default_sorting_field: "published_at_unix",
  },
  {
    name: "drvn-profiles",
    fields: [
      { name: "username", type: "string" },
      { name: "display_name", type: "string" },
      { name: "headline", type: "string" },
      { name: "created_at_unix", type: "int64" },
    ],
    default_sorting_field: "created_at_unix",
  },
];

const client = new Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(pwd)}@db.${ref}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows: cars } = await client.query(`
  select c.id, c.name,
         trim(concat_ws(' ', c.year, c.make, c.model)) as vehicle,
         coalesce(c.tags, '{}') as tags,
         coalesce(c.about, '') as about,
         coalesce((select string_agg(concat_ws(' ', m.brand, m.product, m.part_number), ' ')
                   from public.mod_items m where m.car_id = c.id), '') as mods,
         extract(epoch from c.created_at)::bigint as created_at_unix
  from public.cars c
  where c.is_public
`);

const { rows: updates } = await client.query(`
  select p.id, p.title, coalesce(p.intro, '') as intro,
         coalesce(p.search_text, '') as body_text,
         trim(concat_ws(' ', c.year, c.make, c.model, c.name)) as vehicle,
         extract(epoch from p.published_at)::bigint as published_at_unix
  from public.activity_posts p
  join public.cars c on c.id = p.car_id
  where p.published_at is not null and c.is_public
`);

const { rows: profiles } = await client.query(`
  select p.id, coalesce(p.username, '') as username,
         coalesce(p.display_name, '') as display_name,
         coalesce(p.headline, '') as headline,
         extract(epoch from p.created_at)::bigint as created_at_unix
  from public.profiles p
  where p.suspended_at is null
    and (p.username is not null or p.display_name is not null)
`);

await client.end();

const DOCS = {
  "drvn-cars": cars.map((r) => ({ ...r, created_at_unix: Number(r.created_at_unix) })),
  "drvn-updates": updates.map((r) => ({ ...r, published_at_unix: Number(r.published_at_unix) })),
  "drvn-profiles": profiles.map((r) => ({ ...r, created_at_unix: Number(r.created_at_unix) })),
};

let anyFailed = false;
for (const schema of SCHEMAS) {
  // Recreate each collection for a clean rebuild.
  await fetch(`${TS_URL}/collections/${schema.name}`, { method: "DELETE", headers }).catch(() => {});
  const created = await fetch(`${TS_URL}/collections`, { method: "POST", headers, body: JSON.stringify(schema) });
  if (!created.ok) {
    console.error(`${schema.name}: collection create failed:`, created.status, await created.text());
    process.exit(1);
  }
  const docs = DOCS[schema.name];
  if (!docs.length) {
    console.log(`${schema.name}: 0 documents`);
    continue;
  }
  const body = docs.map((d) => JSON.stringify(d)).join("\n");
  const imported = await fetch(
    `${TS_URL}/collections/${schema.name}/documents/import?action=upsert`,
    { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body },
  );
  const results = (await imported.text()).trim().split("\n").filter(Boolean);
  const failed = results.filter((line) => !line.includes('"success":true')).length;
  if (failed) anyFailed = true;
  console.log(`${schema.name}: indexed ${docs.length - failed}/${docs.length}${failed ? ` (${failed} FAILED)` : ""}`);
}
process.exit(anyFailed ? 1 : 0);
