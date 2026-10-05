import "server-only";
import { COLLECTION_SCHEMA } from "@/lib/marketplace/search/typesense";
import { EXPLORE_COLLECTION_SCHEMAS } from "@/lib/explore/search/typesense";
import { typesenseHeaders } from "./typesense";

/**
 * Bootstrap missing collections without deleting a usable projection, and
 * add fields a newer schema declares to a collection made by an older one
 * (Typesense alters a collection in place; documents indexed before simply
 * lack the field until they are next indexed).
 */
export async function ensureSearchCollections() {
  await Promise.all([COLLECTION_SCHEMA, ...EXPLORE_COLLECTION_SCHEMAS].map(async (schema) => {
    const response = await fetch(`${process.env.TYPESENSE_URL}/collections`, {
      method: "POST", headers: typesenseHeaders(), body: JSON.stringify(schema), signal: AbortSignal.timeout(3000),
    });
    // Typesense's collection-create contract uses 409 for an existing name.
    if (response.ok) return;
    if (response.status !== 409) throw new Error(`Search collection unavailable: ${response.status}`);
    const existing = await fetch(`${process.env.TYPESENSE_URL}/collections/${schema.name}`, {
      headers: typesenseHeaders(), signal: AbortSignal.timeout(3000),
    });
    if (!existing.ok) throw new Error(`Search collection unavailable: ${existing.status}`);
    const have = new Set(((await existing.json()) as { fields?: { name: string }[] }).fields?.map((field) => field.name) ?? []);
    const missing = schema.fields.filter((field) => !have.has(field.name));
    if (!missing.length) return;
    const altered = await fetch(`${process.env.TYPESENSE_URL}/collections/${schema.name}`, {
      method: "PATCH", headers: typesenseHeaders(), body: JSON.stringify({ fields: missing }), signal: AbortSignal.timeout(60000),
    });
    if (!altered.ok) throw new Error(`Search collection could not be altered: ${altered.status}`);
  }));
}
