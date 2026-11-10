/**
 * The public schema's JSON columns, split by who can put text in them
 * (src/lib/database.generated.ts). The photo signer never signs inside a
 * member-writable one except a post body's image blocks
 * (src/lib/photo-urls.ts). src/lib/photo-urls.test.ts fails when the schema
 * gains a JSON column neither list names.
 */

/** A member writes these, directly or through a form whose text is kept. */
export const MEMBER_JSON_COLUMNS: readonly string[] = [
  "body", // activity_posts: blocks; only images.urls and before/after are guarded
  "links", // profiles
  "notification_prefs", // profiles
  "imported_images", // listing_imports: not owner-checked by the database
  "extracted", // listing_imports
  "normalized_source", // listing_imports
  "condition_checklist", // listings
  "params", // saved_searches
  "cards", // agent_messages: written from the model's tool output
  "commercial_snapshot", // order_items: a copy of the seller's listing text
];

/** Only the server or an operator writes these; no member text reaches a photo key in them. */
export const SERVER_JSON_COLUMNS: readonly string[] = [
  "manifest", "payload", "metadata", "inputs", "result", "takedown", "checked", "accepted_checkout_shipping",
  "shipping_quote", "label", "rated", "request", "raw", "detail", "checkout_context", "request_fingerprint",
  "items", "parcel", "summary",
];
