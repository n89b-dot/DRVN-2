export const ACCOUNT_EXPORT_CONTRACT_VERSION = "2026-10-17.v7";
export const ACCOUNT_EXPORT_PAGE_SIZE = 250;

export type ExportAccess =
  | "owner"
  | "author"
  | "transaction_participant"
  | "conversation_participant"
  | "seller";

export type ExportSection = {
  key: string;
  table: string;
  projection: string;
  sourceProjection?: string;
  excludedSourceFields?: string[];
  access: ExportAccess;
  filter: string;
  cursor?: string;
  cutoffColumn?: string;
  counterpartyRule?: string;
  /** Rows per page when smaller than ACCOUNT_EXPORT_PAGE_SIZE — for sections
   *  whose rows each cost storage copies, so one page fits a worker run. */
  pageSize?: number;
};

export function exportPageSize(section: ExportSection) {
  return section.pageSize ?? ACCOUNT_EXPORT_PAGE_SIZE;
}

/** Messages per page of a photo section: at most 4 photos each, every photo
 *  a download and an upload. */
export const MESSAGE_PHOTO_PAGE_SIZE = 10;
export const MESSAGE_PHOTO_SECTIONS = ["message_photos_sent", "message_photos_received"] as const;

/**
 * This is the column-level portability contract. Every field is deliberate:
 * provider payloads, credentials, token/code hashes, idempotency keys, internal
 * recovery detail, admin notes and unrelated counterparty profiles stay out.
 */
export const ACCOUNT_EXPORT_SECTIONS: readonly ExportSection[] = [
  { key: "profiles", table: "profiles", projection: "id,username,display_name,avatar_url,headline,bio,location,country,region,main_car_id,store_note,links,notification_prefs,profile_type,created_at,updated_at", access: "owner", filter: "id", cursor: "id" },
  { key: "account_emails", table: "account_emails", projection: "user_id,email,created_at,updated_at", access: "owner", filter: "user_id", cursor: "user_id", cutoffColumn: "created_at" },
  { key: "cars", table: "cars", projection: "id,owner_id,slug,name,make,model,year,color,about,tags,cover_image_url,is_public,vin,trim,engine,drivetrain,body_class,vin_decoded_at,catalog_make_id,catalog_model_id,identity_source,cover_focal_x,cover_focal_y,created_at,updated_at", access: "owner", filter: "owner_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "car_images", table: "car_images", projection: "id,car_id,url,alt,position,created_at,cars!inner(owner_id)", access: "owner", filter: "cars.owner_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "car_hotspots", table: "car_hotspots", projection: "id,car_id,image_url,x,y,mod_item_id,label,created_at,cars!inner(owner_id)", access: "owner", filter: "cars.owner_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "mod_items", table: "mod_items", projection: "id,car_id,group_label,category,brand,product,part_number,raw_text,linked_listing_id,confidence,position,status,removed_at,source_order_item_id,product_url,image_url,source_domain,ref_price_cents,ref_price_currency,created_at,updated_at,cars!inner(owner_id)", access: "owner", filter: "cars.owner_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "activity_posts", table: "activity_posts", projection: "id,car_id,author_id,title,intro,body,video_url,published_at,created_at,updated_at", access: "author", filter: "author_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "activity_post_listings", table: "activity_post_listings", projection: "post_id,listing_id,position,activity_posts!inner(author_id)", access: "author", filter: "activity_posts.author_id", cursor: "post_id,listing_id" },
  { key: "activity_images", table: "activity_images", projection: "id,post_id,url,alt,position,created_at,activity_posts!inner(author_id)", access: "author", filter: "activity_posts.author_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "activity_comments", table: "activity_comments", projection: "id,post_id,author_id,body,created_at", access: "author", filter: "author_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "activity_reactions", table: "activity_reactions", projection: "post_id,user_id,emoji,created_at", access: "owner", filter: "user_id", cursor: "post_id,emoji", cutoffColumn: "created_at" },
  { key: "listings", table: "listings", projection: "id,seller_id,source_car_id,title,description,category,subcategory,condition,price_cents,currency,location,compatibility_notes,status,shipping_cents,allows_collection,sold_at,reserved_until,part_number,brand,part_miles,part_miles_unit,removed_at,grade,condition_checklist,shipping_mode,weight_oz,length_in,width_in,height_in,created_at,updated_at", access: "seller", filter: "seller_id", cursor: "id", cutoffColumn: "created_at" },
  // The offer minimum, private to the seller (20261017130000).
  { key: "listing_private_terms", table: "listing_private_terms", projection: "listing_id,seller_id,offer_floor_cents,updated_at", access: "seller", filter: "seller_id", cursor: "listing_id" },
  { key: "listing_images", table: "listing_images", projection: "id,listing_id,url,alt,position,created_at,listings!inner(seller_id)", access: "seller", filter: "listings.seller_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "listing_fitments", table: "listing_fitments", projection: "id,listing_id,make,model,year_start,year_end,created_at,listings!inner(seller_id)", access: "seller", filter: "listings.seller_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "listing_part_numbers", table: "listing_part_numbers", projection: "id,listing_id,number,created_at,listings!inner(seller_id)", access: "seller", filter: "listings.seller_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "listing_questions", table: "listing_questions", projection: "id,listing_id,author_id,parent_id,body,created_at", access: "author", filter: "author_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "listing_imports", table: "listing_imports", projection: "id,user_id,source_mode,source_adapter,source_url,canonical_url,source_domain,status,selected_item,error_code,error_detail,listing_id,created_at,updated_at,completed_at,consumed_at,expires_at", access: "owner", filter: "user_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "staged_uploads", table: "staged_uploads", projection: "id,owner_id,bucket,path,url,created_at,consumed_at", access: "owner", filter: "owner_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "saves", table: "saves", projection: "user_id,target_type,target_id,created_at", access: "owner", filter: "user_id", cursor: "target_type,target_id", cutoffColumn: "created_at" },
  { key: "follows", table: "follows", projection: "follower_id,target_type,target_id,created_at", access: "owner", filter: "follower_id", cursor: "target_type,target_id", cutoffColumn: "created_at" },
  { key: "likes", table: "likes", projection: "user_id,target_type,target_id,created_at", access: "owner", filter: "user_id", cursor: "target_type,target_id", cutoffColumn: "created_at" },
  { key: "notifications", table: "notifications", projection: "id,user_id,kind,section,title,body,href,actor_id,read_at,created_at", access: "owner", filter: "user_id", cursor: "id", cutoffColumn: "created_at", counterpartyRule: "Includes notification text already delivered to the requester; no actor profile is joined." },
  { key: "saved_searches", table: "saved_searches", projection: "id,user_id,name,params,alert,last_checked_at,last_matched_at,created_at", access: "owner", filter: "user_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "analytics_consent", table: "analytics_consents", projection: "user_id,allowed,version,expires_at", access: "owner", filter: "user_id", cursor: "user_id" },
  { key: "shop_profile", table: "shop_profiles", projection: "profile_id,verification_status,returns_accepted,return_window_days,created_at,updated_at", access: "owner", filter: "profile_id", cursor: "profile_id", cutoffColumn: "created_at" },
  { key: "fulfillment_profile", table: "seller_fulfillment_profiles", projection: "seller_id,ship_from_name,company,street1,street2,city,state,postal_code,country,phone,return_name,return_street1,return_street2,return_city,return_state,return_postal_code,return_country,default_handling_days,address_verified_at,created_at,updated_at", access: "owner", filter: "seller_id", cursor: "seller_id", cutoffColumn: "created_at" },
  { key: "orders", table: "orders", projection: "id,buyer_id,seller_id,status,subtotal_cents,shipping_cents,platform_fee_cents,total_cents,currency,ship_name,ship_line1,ship_line2,ship_city,ship_state,ship_postcode,ship_country,ship_phone,is_collection,carrier,tracking_number,shipped_at,delivered_at,completed_at,cancelled_at,cancel_reason,buyer_label,seller_label,dispute_category,dispute_reason,disputed_at,disputed_by,dispute_resolved_at,pre_dispute_status,refund_offer_cents,refund_offered_at,transferred_at,refunded_cents,platform_fee_refunded_cents,refunded_at,dispute_escalated_at,dispute_outcome,shipping_quote,pickup_ready_at,created_at,updated_at", access: "transaction_participant", filter: "buyer_id|seller_id", cursor: "id", cutoffColumn: "created_at", counterpartyRule: "Includes the shared order and delivery record, including the destination supplied for that transaction; excludes provider references and unrelated profile data." },
  { key: "order_items", table: "order_items", projection: "id,order_id,listing_id,title,price_cents,shipping_cents,quantity,condition_snapshot,commercial_snapshot,snapshot_version,orders!inner(id,buyer_id,seller_id)", access: "transaction_participant", filter: "orders.buyer_id|orders.seller_id", cursor: "id" },
  { key: "order_snapshot_images", table: "order_item_snapshot_images", projection: "id,order_item_id,url,alt,position,created_at,order_items!inner(order_id,orders!inner(buyer_id,seller_id))", access: "transaction_participant", filter: "order_items.orders.buyer_id|order_items.orders.seller_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "offers_made", table: "offers", projection: "id,listing_id,buyer_id,amount_cents,counter_amount_cents,status,countered_at,expires_at,responded_at,created_at,updated_at", access: "transaction_participant", filter: "buyer_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "offers_received", table: "offers", projection: "id,listing_id,buyer_id,amount_cents,counter_amount_cents,status,countered_at,expires_at,responded_at,created_at,updated_at,listings!inner(seller_id)", access: "seller", filter: "listings.seller_id", cursor: "id", cutoffColumn: "created_at", counterpartyRule: "Includes the buyer id and offer terms disclosed to the seller; no buyer profile is joined." },
  // Each negotiation move, both sides of the member's offers (20261017150000). The acting member's id is left out; the role says who moved.
  { key: "offer_rounds_made", table: "offer_rounds", projection: "id,offer_id,round_no,listing_id,buyer_id,actor_role,kind,amount_cents,expires_at,created_at", access: "transaction_participant", filter: "buyer_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "offer_rounds_received", table: "offer_rounds", projection: "id,offer_id,round_no,listing_id,buyer_id,actor_role,kind,amount_cents,expires_at,created_at,listings!inner(seller_id)", access: "seller", filter: "listings.seller_id", cursor: "id", cutoffColumn: "created_at", counterpartyRule: "Includes the buyer id and offer terms already disclosed to the seller; no buyer profile is joined." },
  { key: "messages_sent", table: "messages", projection: "id,listing_id,offer_id,order_id,conversation_id,sender_id,recipient_id,kind,body,attachments,read_at,created_at", access: "conversation_participant", filter: "sender_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "messages_received", table: "messages", projection: "id,listing_id,offer_id,order_id,conversation_id,sender_id,recipient_id,kind,body,attachments,read_at,created_at", access: "conversation_participant", filter: "recipient_id", cursor: "id", cutoffColumn: "created_at", counterpartyRule: "Includes only messages addressed to the requester and the sender id needed to preserve conversation context." },
  // The photos themselves. `attachments` above is only their private storage
  // paths; these two sections list each message that has photos and the
  // worker copies every photo into the package beside the listing.
  { key: "message_photos_sent", table: "messages", projection: "id,conversation_id,sender_id,recipient_id,attachments,created_at", access: "conversation_participant", filter: "sender_id", cursor: "id", cutoffColumn: "created_at", pageSize: MESSAGE_PHOTO_PAGE_SIZE, counterpartyRule: "Photos the requester sent, copied into the private export package." },
  { key: "message_photos_received", table: "messages", projection: "id,conversation_id,sender_id,recipient_id,attachments,created_at", access: "conversation_participant", filter: "recipient_id", cursor: "id", cutoffColumn: "created_at", pageSize: MESSAGE_PHOTO_PAGE_SIZE, counterpartyRule: "Photos sent to the requester in their own conversations, copied into the private export package; no sender profile is joined." },
  { key: "reviews_written", table: "reviews", projection: "id,order_id,reviewer_id,reviewee_id,rating,body,created_at", access: "author", filter: "reviewer_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "reviews_received", table: "reviews", projection: "id,order_id,reviewer_id,reviewee_id,rating,body,created_at", access: "owner", filter: "reviewee_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "payments", table: "payments", projection: "id,order_id,provider,status,amount_cents,refunded_cents,currency,failure_reason,created_at,updated_at,orders!inner(buyer_id,seller_id)", access: "transaction_participant", filter: "orders.buyer_id|orders.seller_id", cursor: "id", cutoffColumn: "created_at", counterpartyRule: "Provider reference, idempotency key and raw provider payload are excluded." },
  { key: "transfers", table: "transfer_intents", projection: "order_id,seller_id,amount_cents,currency,status,available_at,created_at,updated_at", access: "seller", filter: "seller_id", cursor: "order_id", cutoffColumn: "created_at", counterpartyRule: "Provider transfer/source references and internal retry diagnostics are excluded." },
  { key: "refunds", table: "refund_operations", projection: "id,order_id,amount_cents,currency,remaining_before_cents,reason,requested_by,actor_role,status,resolve_dispute,dispute_outcome,created_at,updated_at,provider_completed_at,effects_completed_at,reversal_completed_at,purpose,provider_status,provider_failure_reason,orders!inner(buyer_id,seller_id)", access: "transaction_participant", filter: "orders.buyer_id|orders.seller_id", cursor: "id", cutoffColumn: "created_at", counterpartyRule: "Provider, recovery and idempotency references are excluded." },
  { key: "refund_adjustments", table: "refund_lifecycle_adjustments", projection: "id,refund_operation_id,kind,refund_amount_cents,fee_restore_cents,seller_recredit_cents,created_at,refund_operations!inner(order_id,orders!inner(buyer_id,seller_id))", access: "transaction_participant", filter: "refund_operations.orders.buyer_id|refund_operations.orders.seller_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "returns", table: "returns", projection: "id,order_id,requested_by,return_type,reason,responsibility,status,requested_at,approved_at,ship_by,shipped_at,delivered_at,seller_respond_by,received_at,completed_at,refund_amount_cents,label_deduction_cents,refund_operation_id,created_at,updated_at,orders!inner(buyer_id,seller_id)", access: "transaction_participant", filter: "orders.buyer_id|orders.seller_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "return_items", table: "return_items", projection: "return_id,order_item_id,quantity,reason,inspection_status,inspection_note,returns!inner(order_id,orders!inner(buyer_id,seller_id))", access: "transaction_participant", filter: "returns.orders.buyer_id|returns.orders.seller_id", cursor: "return_id,order_item_id" },
  { key: "dispute_evidence", table: "dispute_evidence", projection: "id,order_id,uploader_id,note,created_at,storage_path,orders!inner(buyer_id,seller_id)", access: "transaction_participant", filter: "orders.buyer_id|orders.seller_id", cursor: "id", cutoffColumn: "created_at", counterpartyRule: "Only evidence for the requester's orders is copied into the private export package." },
  { key: "shipments", table: "shipments", projection: "id,order_id,direction,return_id,provider,fulfillment_type,carrier,service,status,tracking_code,quoted_cents,purchased_cents,insured_value_cents,signature_required,shipped_at,delivered_at,created_at,updated_at,orders!inner(buyer_id,seller_id)", access: "transaction_participant", filter: "orders.buyer_id|orders.seller_id", cursor: "id", cutoffColumn: "created_at", counterpartyRule: "Provider shipment/tracker and label references are excluded." },
  { key: "shipment_items", table: "shipment_items", projection: "shipment_id,order_item_id,shipments!inner(order_id,orders!inner(buyer_id,seller_id))", access: "transaction_participant", filter: "shipments.orders.buyer_id|shipments.orders.seller_id", cursor: "shipment_id,order_item_id" },
  { key: "shipment_events", table: "shipment_events", projection: "id,shipment_id,status,description,occurred_at,city,state,country,created_at,shipments!inner(order_id,orders!inner(buyer_id,seller_id))", access: "transaction_participant", filter: "shipments.orders.buyer_id|shipments.orders.seller_id", cursor: "id", cutoffColumn: "created_at", counterpartyRule: "Provider event reference is excluded." },
  { key: "seller_adjustments", table: "seller_adjustments", projection: "id,seller_id,order_id,shipment_id,return_id,kind,amount_cents,currency,description,created_at,voided_at", access: "seller", filter: "seller_id", cursor: "id", cutoffColumn: "created_at", counterpartyRule: "External adjustment reference is excluded." },
  // Label costs (and their refunds) an order's own payout didn't settle, and
  // what later payouts kept back for them. The write-once entry key and the
  // internal adjustment id stay out.
  { key: "seller_carry_entries", table: "seller_carry_entries", projection: "id,seller_id,kind,amount_cents,currency,order_id,created_at", access: "seller", filter: "seller_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "seller_carry_payouts", table: "seller_carry_payouts", projection: "id,seller_id,amount_cents,currency,status,paid_at,created_at", access: "seller", filter: "seller_id", cursor: "id", cutoffColumn: "created_at", counterpartyRule: "The Stripe account, transfer reference and retry diagnostics are excluded." },
  { key: "shipping_quotes", table: "shipping_rate_quotes", projection: "id,buyer_id,listing_id,provider,carrier,service,service_label,amount_cents,currency,est_delivery_days,parcel,consumed_order_id,expires_at,created_at", access: "owner", filter: "buyer_id", cursor: "id", cutoffColumn: "created_at", counterpartyRule: "Destination hash and provider rate/shipment references are excluded." },
  { key: "pickup_confirmations", table: "pickup_confirmations", projection: "order_id,attempts,expires_at,redeemed_at,redeemed_by,created_at,orders!inner(buyer_id,seller_id)", access: "transaction_participant", filter: "orders.buyer_id|orders.seller_id", cursor: "order_id", cutoffColumn: "created_at", counterpartyRule: "Pickup token and code hashes are excluded." },
  { key: "reports_filed", table: "reports", projection: "id,reporter_id,subject_type,subject_id,reason,detail,status,resolved_at,created_at", access: "author", filter: "reporter_id", cursor: "id", cutoffColumn: "created_at" },
  { key: "refund_recredit_proofs", table: "refund_recredit_proofs", projection: "amount_cents,currency,verified_at", sourceProjection: "adjustment_id,amount_cents,currency,verified_at", excludedSourceFields: ["adjustment_id"], access: "transaction_participant", filter: "authorized refund adjustment", cursor: "adjustment_id", counterpartyRule: "Includes the amount, currency and verification time needed to explain the requester's refund; internal adjustment/recovery ids, provider balance/transfer references and operator identity are excluded." },
] as const;

/** True when a storage download failed because the object isn't there. */
export function storageObjectMissing(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const { status, statusCode, message, originalError } = error as { status?: unknown; statusCode?: unknown; message?: unknown; originalError?: { status?: unknown } };
  return [status, statusCode, originalError?.status].some((code) => String(code) === "404")
    || (typeof message === "string" && /not[ _]found/i.test(message));
}

export const ACCOUNT_EXPORT_EXCLUSIONS = [
  "authentication credentials, factor secrets and session tokens",
  "raw payment/webhook/refund provider payloads and provider secret references",
  "idempotency keys, recovery internals, pickup hashes and rate-limit identities",
  "administrator notes, assignments and unrelated audit/operator case data",
  "external analytics-provider event copies (provider and retention policy pending)",
] as const;

export function nextExportCheckpoint(
  section: ExportSection,
  current: { section: number; offset: number; cursor: string | null },
  rows: Array<Record<string, unknown>>,
) {
  if (rows.length < exportPageSize(section)) return { section: current.section + 1, offset: 0, cursor: null };
  return {
    section: current.section,
    offset: current.offset + rows.length,
    cursor: section.cursor ? JSON.stringify(section.cursor.split(",").map((field) => rows.at(-1)?.[`__cursor_${field}`] ?? rows.at(-1)?.[field])) : null,
  };
}

export function exportCursorFilter(fields: string[], encodedCursor: string) {
  let decoded: unknown;
  try { decoded = JSON.parse(encodedCursor); }
  catch { decoded = fields.length === 1 ? encodedCursor : null; }
  const values = Array.isArray(decoded) ? decoded : fields.length === 1 ? [decoded] : [];
  if (values.length !== fields.length || values.some((value) => typeof value !== "string" && typeof value !== "number")) {
    throw new Error("Invalid export cursor");
  }
  const literal = (value: unknown) => `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  return fields.map((field, index) => {
    const clauses = fields.slice(0, index).map((prior, priorIndex) => `${prior}.eq.${literal(values[priorIndex])}`);
    clauses.push(`${field}.gt.${literal(values[index])}`);
    return clauses.length === 1 ? clauses[0] : `and(${clauses.join(",")})`;
  }).join(",");
}

export function exportDownloadDecision(
  requesterId: string | null,
  request: { user_id: string; status: string; expires_at: string } | null,
  now = Date.now(),
) {
  if (!requesterId) return "unauthenticated" as const;
  if (!request || request.user_id !== requesterId) return "not_found" as const;
  if (request.status === "expired" || new Date(request.expires_at).getTime() <= now) return "expired" as const;
  if (request.status !== "completed") return "not_ready" as const;
  return "allowed" as const;
}
