// Full search reindex (brief §B1): rebuilds the Typesense collection from
// Postgres — the canonical truth — in pages. Run after enabling the engine,
// after schema changes, or to recover from index corruption. No-ops loudly
// without TYPESENSE_URL/TYPESENSE_API_KEY. Per-listing sync afterwards is
// handled by syncListingToSearch on publish/edit/status change.
// Usage: node scripts/reindex-search.mjs
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
const COLLECTION = "drvn-listings";
const SCHEMA = {
  name: COLLECTION,
  fields: [
    { name: "title", type: "string" },
    { name: "description", type: "string" },
    { name: "compatibility_notes", type: "string" },
    { name: "part_numbers", type: "string[]" },
    { name: "category", type: "string", facet: true },
    { name: "subcategory", type: "string", facet: true },
    { name: "fitment", type: "string[]" },
    { name: "source_car", type: "string" },
    { name: "status", type: "string", facet: true },
    { name: "price_cents", type: "int64" },
    { name: "created_at_unix", type: "int64" },
  ],
  default_sorting_field: "created_at_unix",
};

// Recreate the collection for a clean rebuild.
await fetch(`${TS_URL}/collections/${COLLECTION}`, { method: "DELETE", headers }).catch(() => {});
const created = await fetch(`${TS_URL}/collections`, { method: "POST", headers, body: JSON.stringify(SCHEMA) });
if (!created.ok) {
  console.error("collection create failed:", created.status, await created.text());
  process.exit(1);
}

const client = new Client({
  connectionString: `postgresql://postgres:${encodeURIComponent(pwd)}@db.${ref}.supabase.co:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const { rows } = await client.query(`
  select l.id, l.title, coalesce(l.description,'') as description,
         coalesce(l.compatibility_notes,'') as compatibility_notes,
         l.part_number, l.part_number_compact,
         coalesce(l.category,'') as category, coalesce(l.subcategory,'') as subcategory,
         l.status, l.price_cents, extract(epoch from l.created_at)::bigint as created_at_unix,
         coalesce((select array_agg(n.number) from public.listing_part_numbers n where n.listing_id = l.id), '{}') as alt_numbers,
         coalesce((select array_agg(trim(concat_ws(' ', f.make, f.model, f.year_start, f.year_end))) from public.listing_fitments f where f.listing_id = l.id), '{}') as fitment,
         coalesce(trim(concat_ws(' ', c.year, c.make, c.model)), '') as source_car
  from public.listings l
  left join public.cars c on c.id = l.source_car_id
  where l.status = 'active'
`);
await client.end();

const docs = rows.map((r) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  compatibility_notes: r.compatibility_notes,
  part_numbers: [r.part_number, r.part_number_compact, ...r.alt_numbers].filter(Boolean),
  category: r.category,
  subcategory: r.subcategory,
  fitment: r.fitment,
  source_car: r.source_car,
  status: r.status,
  price_cents: Number(r.price_cents),
  created_at_unix: Number(r.created_at_unix),
}));

const body = docs.map((d) => JSON.stringify(d)).join("\n");
const imported = await fetch(
  `${TS_URL}/collections/${COLLECTION}/documents/import?action=upsert`,
  { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body },
);
const results = (await imported.text()).trim().split("\n").filter(Boolean);
const failed = results.filter((line) => !line.includes('"success":true')).length;
console.log(`indexed ${docs.length - failed}/${docs.length} active listings${failed ? ` (${failed} FAILED)` : ""}`);
process.exit(failed ? 1 : 0);
