/**
 * The public schema's JSON columns, as `table.column`, split by whose text
 * can reach them (src/lib/database.generated.ts). The photo signer never
 * signs anything inside a JSON column except a post body's image blocks
 * (activity_posts.body, PHOTO_POSITIONS in src/lib/photo-urls.ts), and never
 * takes a row's owner from inside one. src/lib/photo-urls.test.ts fails when
 * the schema gains a JSON column neither list names (N940).
 */

/** A member, the model acting for one, or a page a member pointed at writes text into these. */
export const MEMBER_JSON_COLUMNS: readonly string[] = [
  "activity_posts.body", // blocks; only images.urls and before/after are guarded
  "profiles.links",
  "profiles.notification_prefs",
  "listing_imports.imported_images", // not owner-checked by the database
  "listing_imports.extracted",
  "listing_imports.normalized_source",
  "listings.condition_checklist",
  "saved_searches.params",
  "agent_messages.cards", // written from the model's tool output
  "agent_events.inputs", // the model's tool inputs
  "agent_events.result", // what a tool answered, member text included
  "order_items.commercial_snapshot", // a copy of the seller's listing text
  "order_items.condition_snapshot", // a copy of the seller's condition checklist
];

/** Only the server, an operator or a provider writes these; no member text is read from a photo key in them. */
export const SERVER_JSON_COLUMNS: readonly string[] = [
  "account_export_requests.manifest",
  "admin_alert_outbox.payload",
  "admin_audit_log.metadata",
  "copyright_notices.takedown",
  "ledger_reconciliation_runs.checked",
  "orders.accepted_checkout_shipping",
  "orders.shipping_quote",
  "outbound_label_requests.label",
  "outbound_label_requests.rated",
  "payment_requests.request",
  "payments.raw",
  "product_grow_runs.result",
  "product_identity_reviews.detail",
  "purchase_attempts.checkout_context",
  "purchase_attempts.request_fingerprint",
  "purchase_attempts.result",
  "remediation_jobs.payload",
  "return_label_requests.label",
  "return_label_requests.rated",
  "saved_search_email_digests.items",
  "shipping_rate_quotes.parcel",
  "webhook_events.payload",
  "worker_runs.summary",
];
