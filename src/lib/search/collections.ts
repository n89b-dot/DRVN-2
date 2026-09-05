import "server-only";
import { COLLECTION_SCHEMA } from "@/lib/marketplace/search/typesense";
import { EXPLORE_COLLECTION_SCHEMAS } from "@/lib/explore/search/typesense";
import { typesenseHeaders } from "./typesense";

/** Bootstrap missing collections without deleting a usable projection. */
export async function ensureSearchCollections() {
  await Promise.all([COLLECTION_SCHEMA, ...EXPLORE_COLLECTION_SCHEMAS].map(async (schema) => {
    const response = await fetch(`${process.env.TYPESENSE_URL}/collections`, {
      method: "POST", headers: typesenseHeaders(), body: JSON.stringify(schema), signal: AbortSignal.timeout(3000),
    });
    // Typesense's collection-create contract uses 409 for an existing name.
    if (!response.ok && response.status !== 409) throw new Error(`Search collection unavailable: ${response.status}`);
  }));
}
