import type { Database as GeneratedDatabase } from "./database.generated";

// Curated application/domain types retained for compatibility.
// database.generated.ts is the generated public-schema contract; regenerate
// with npm run db:types and verify drift with npm run db:types:check.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  /** Stripe Customer pointer (migration 0015, applied 1 Aug 2026). */
  stripe_customer_id: string | null;
  /** Stripe Connect account pointer (migration 0016). */
  stripe_account_id: string | null;
  /** Synced from Stripe's account state; gates publishing when payments are real. */
  payouts_enabled: boolean;
  headline: string | null;
  bio: string | null;
  location: string | null;
  links: Json;
  notification_prefs: Json;
  profile_type: "user" | "shop";
  /** The car this member actually means (P-5). Drives the featured car, the
   *  default profile banner, car order everywhere, the Garage's focused view
   *  and the first one-tap suggestion in the marketplace vehicle picker.
   *  Null is the ordinary state — readers fall back to newest-first. */
  main_car_id: string | null;
  /** One short line above this member's parts grid (P-8). Voice, not policy
   *  — the database caps it at 180 characters. */
  store_note: string | null;
  /** P-9: the lowest share of the asking price this seller will consider.
   *  A DEFAULT for the sell form — never retroactive to a live listing. */
  default_offer_floor_pct: number | null;
  /** H-2. Coarse on purpose: Local needs the right ballpark, not a town. */
  country: string | null;
  region: string | null;
  /** Moderation suspension (migration 0018). Service-role-written; unreadable
   *  by client roles — read via is_suspended() or the service client. */
  suspended_at: string | null;
  suspended_reason: string | null;
  /** One-time importer content-rights acknowledgement (0047). */
  import_attested_at: string | null;
  /** AG-7: how far the member's agent may go (20261107170000). Owner-written;
   *  no client select grant — read server-side by loadAgentMode(). */
  agent_mode: "off" | "suggest" | "act";
  created_at: string;
  updated_at: string;
};

/**
 * Service-role-only email → account index (migration 0036). RLS is enabled
 * with no policies, so anon/authenticated read nothing; only the admin client
 * touches it, and only to answer "does this email already have an account?"
 * during guest checkout. Never expose it through a client-facing query.
 */
export type AccountEmail = {
  user_id: string;
  email: string;
  created_at: string;
  updated_at: string;
};

export type Car = {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  about: string | null;
  tags: string[];
  cover_image_url: string | null;
  is_public: boolean;
  /** VIN + decoded identity (migration 0025). The VIN verifies; the decoded
   *  fields are what fitment matching reads. */
  vin: string | null;
  trim: string | null;
  engine: string | null;
  drivetrain: string | null;
  body_class: string | null;
  vin_decoded_at: string | null;
  /** Canonical catalog references (0041). The display strings above are the
   *  frozen snapshot; these point at the DRVN-owned catalog rows. */
  catalog_make_id: number | null;
  catalog_model_id: number | null;
  /** 'picker' | 'vin' | 'manual' — how the identity was established (0041). */
  identity_source: string | null;
  /** Cover framing focal point 0..1 (0043). Null = centered. Render-only. */
  cover_focal_x: number | null;
  cover_focal_y: number | null;
  created_at: string;
  updated_at: string;
};

/** DRVN-owned vehicle catalog (0041) — identity DRVN controls, with source
 *  references (vPIC ids, VehiclesDB ids) rather than external primary keys. */
export type CatalogMake = {
  id: number;
  name: string;
  slug: string;
  vpic_make_id: number | null;
  vdb_id: string | null;
  /** 1 (most common) … 10; null = unknown, ranked last. */
  popularity_decile: number | null;
  source: string;
  source_version: string | null;
  created_at: string;
  updated_at: string;
};

export type CatalogModel = {
  id: number;
  make_id: number;
  name: string;
  vdb_id: string | null;
  /** Market alternate names ("Golf" ↔ "Rabbit") — searched, never displayed. */
  aliases: string[] | null;
  popularity_decile: number | null;
  source: string;
  source_version: string | null;
  created_at: string;
  updated_at: string;
};

export type CarImage = {
  id: string;
  car_id: string;
  url: string;
  alt: string | null;
  position: number;
  created_at: string;
};

export type ActivityPost = {
  id: string;
  /** Optional since W-5: a post must be about a car, a tagged part, or both
   *  — the database enforces the pair, not the composer. */
  car_id: string | null;
  author_id: string;
  /** Optional since the 2026-09 direction (W-1): a quick post is a photo and
   *  a caption, and inventing a heading would be writing on somebody's
   *  behalf. Read it through `postHeadline()`, never directly. */
  title: string | null;
  intro: string | null;
  body: Json;
  video_url: string | null;
  published_at: string | null;
  /** Generated column (0057): the user-visible text of `body`, extracted by
   *  activity_post_search_text() for the Explore search RPCs. Read-only. */
  search_text: string | null;
  created_at: string;
  updated_at: string;
};

export type ActivityImage = {
  id: string;
  post_id: string;
  url: string;
  alt: string | null;
  position: number;
  created_at: string;
};

export type ListingStatus =
  | "draft"
  | "active"
  /** Held by an in-flight checkout; released by `release_expired_reservations`. */
  | "reserved"
  | "paused"
  | "sold"
  | "archived"
  /** Admin takedown (migration 0018). Set and cleared by moderation only. */
  | "removed";

export type Listing = {
  id: string;
  seller_id: string;
  source_car_id: string | null;
  title: string;
  description: string | null;
  category: string;
  subcategory: string | null;
  condition: "new" | "like_new" | "used" | "for_parts" | null;
  /** Manufacturer part number, seller-entered. Not platform-verified. */
  part_number: string | null;
  /** Who made the part (M-6). Prefilled from the mod or the importer,
   *  matched from the title otherwise, backfilled, always editable. */
  brand: string | null;
  /** How far this part has been driven (M-7). Used parts only; optional. */
  part_miles: number | null;
  /** "mi" | "km" — required by the database whenever part_miles is set. */
  part_miles_unit: string | null;
  /** Generated (0033): lowercase, separators stripped — the searchable form. */
  part_number_compact: string | null;
  price_cents: number;
  /** Seller-set flat shipping, charged on top of the asking price. */
  shipping_cents: number;
  allows_collection: boolean;
  /** How this listing ships (0053): 'flat' seller-arranged, 'drvn' rated
   *  DRVN Shipping (requires the parcel below), 'pickup_only'. */
  shipping_mode: "flat" | "drvn" | "pickup_only";
  /** Seller-declared packed parcel (0053) — required for 'drvn'. */
  weight_oz: number | null;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
  currency: string;
  location: string | null;
  compatibility_notes: string | null;
  /** Seller-declared condition grade (migration 0024): 'a' | 'b' | 'c'. */
  grade: ConditionGrade | null;
  /** Per-category checklist answers: { question_key: 'yes'|'no'|'unknown' }.
   *  The question catalog lives in src/lib/marketplace/grading.ts. */
  condition_checklist: Json | null;
  status: ListingStatus;
  /** Public part-sheet loads, excluding the seller. */
  view_count: number;
  sold_at: string | null;
  reserved_until: string | null;
  /** Takedown bookkeeping (migration 0018). */
  removed_at: string | null;
  removed_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type ListingImage = {
  id: string;
  listing_id: string;
  url: string;
  alt: string | null;
  position: number;
  created_at: string;
};

/** installed | removed. Removal is a state, not a delete (A-2). */
export type ModStatus = "installed" | "removed";

export type ModItem = {
  id: string;
  car_id: string;
  group_label: string;
  category: string | null;
  brand: string | null;
  product: string | null;
  part_number: string | null;
  raw_text: string | null;
  linked_listing_id: string | null;
  confidence: number | null;
  position: number;
  /** A removed line keeps its id so listings, updates and the public build
   *  sheet can still name the part — see "came off this car". */
  status: ModStatus;
  /** Set exactly when status is "removed"; the database enforces the pair. */
  removed_at: string | null;
  /** The order item this mod was built from (C-1). Unique where set, so a
   *  second "add to my car" adds nothing. */
  source_order_item_id: string | null;
  /** Where the owner pasted the part from — rendered as a plain link out. */
  product_url: string | null;
  /** Thumbnail imported from that link. Never a listing photo (L-4). */
  image_url: string | null;
  source_domain: string | null;
  /** Shop price when the link was read. Reference only, never a DRVN price. */
  ref_price_cents: number | null;
  /** ISO-4217 for ref_price_cents. No currency means no price. */
  ref_price_currency: string | null;
  /** aftermarket (fitted by the owner) or stock (a factory part that came
   *  off when a mod went on — "What came off"). */
  origin: ModOrigin;
  created_at: string;
  updated_at: string;
};

export type ModOrigin = "aftermarket" | "stock";

export type ActivityReaction = {
  post_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type ActivityComment = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

export type Save = {
  user_id: string;
  /** 'post' since 0037 — a bookmarked build update. */
  target_type: "listing" | "car" | "profile" | "post";
  target_id: string;
  created_at: string;
};

/** Public "this is great" signal on listings/cars (migration 0037). Posts
 *  express the same gesture through activity_reactions instead. */
export type Like = {
  user_id: string;
  target_type: "listing" | "car";
  target_id: string;
  created_at: string;
};

export type Follow = {
  follower_id: string;
  target_type: "car" | "profile";
  target_id: string;
  created_at: string;
};

export type OrderStatus =
  | "pending"
  | "requires_action"
  | "payment_failed"
  | "paid"
  | "shipped"
  | "delivered"
  | "completed"
  | "cancelled"
  | "refunded"
  | "disputed";

export type Order = {
  id: string;
  // Nullable since 0007: deleting an account anonymises its orders rather than
  // cascading them away, so the counterparty keeps their history.
  buyer_id: string | null;
  seller_id: string | null;
  buyer_label: string | null;
  seller_label: string | null;
  status: OrderStatus;
  subtotal_cents: number;
  shipping_cents: number;
  platform_fee_cents: number;
  total_cents: number;
  currency: string;
  ship_name: string | null;
  ship_line1: string | null;
  ship_line2: string | null;
  ship_city: string | null;
  ship_postcode: string | null;
  /** Free-text on legacy orders; ISO 3166-1 alpha-2 code on new ones (0028) — see countryLabel(). */
  ship_country: string | null;
  /** State / province / region (migration 0028) — optional, required client-side for US/CA/AU. */
  ship_state: string | null;
  ship_phone: string | null;
  is_collection: boolean;
  /** DRVN Shipping service frozen at checkout (0053, §15.7): per-listing
   *  provider/service/amount/parcel. Null for flat/pickup orders. */
  shipping_quote: Json | null;
  /** Seller marked this collection order ready for handoff (0054). */
  pickup_ready_at: string | null;
  carrier: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  /** Set by migration 0014 (applied to the live database 31 Jul 2026). */
  dispute_category: DisputeCategory | null;
  dispute_reason: string | null;
  disputed_at: string | null;
  disputed_by: string | null;
  dispute_resolved_at: string | null;
  /** Escalation stamp — day-4 cron (0021) or the buyer's explicit "step in". */
  dispute_escalated_at: string | null;
  /** Who escalated: the buyer's id, or null for the cron (migration 0024). */
  dispute_escalated_by: string | null;
  /** How the dispute ended (migration 0024). */
  dispute_outcome: DisputeOutcome | null;
  /** Once-only marker for the ops webhook alert on SLA breach (migration 0022). */
  dispute_sla_alerted_at: string | null;
  /** Status to restore on resolution — always shipped/delivered/completed. */
  pre_dispute_status: OrderStatus | null;
  /** The seller's outstanding refund offer, awaiting buyer acceptance. */
  refund_offer_cents: number | null;
  refund_offered_at: string | null;
  /** Stripe Transfer that moved this order's net to the seller (migration 0016). */
  transfer_reference: string | null;
  transferred_at: string | null;
  /** Refunds recorded as explicit adjustments (migration 0019) — the checkout
   *  figures above stay frozen; derived numbers subtract these. */
  refunded_cents: number;
  platform_fee_refunded_cents: number;
  refunded_at: string | null;
  /** The accepted offer this order came from (migration 0034). Null on
   *  buy-now and cart orders, which have no negotiation behind them. */
  origin_offer_id: string | null;
  /** One identity across a checkout's lifetime (migration 0039): shared by the
   *  basket's orders and stamped into the Stripe PaymentIntent metadata.
   *  Observability only — never a money-path key. Null pre-0039. */
  correlation_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ConditionGrade = "a" | "b" | "c";

/** How a dispute ended (migration 0024). Stamped by the resolution paths;
 *  a seller "defect" is any outcome that returned the buyer's money. */
export type DisputeOutcome =
  | "refund_accepted"
  | "closed_by_buyer"
  | "auto_refunded"
  | "admin_refunded"
  | "admin_resolved"
  | "chargeback_lost";

export type DisputeCategory =
  | "item_not_received"
  | "item_not_as_described"
  | "damaged_in_transit"
  | "wrong_item"
  | "other";

export type OrderItem = {
  id: string;
  order_id: string;
  listing_id: string | null;
  title: string | null;
  price_cents: number;
  shipping_cents: number;
  quantity: number;
  /** The listing's condition/grade/checklist frozen at purchase by trigger
   *  (migration 0024) — the contract a dispute is judged against. */
  condition_snapshot: Json | null;
  /** Everything the buyer purchased, frozen at purchase by trigger (0049):
   *  listing identity, part numbers, condition, fitment, source car,
   *  commercial terms, seller identity. Immutable; DB-guaranteed NOT NULL. */
  commercial_snapshot: Json;
  /** Shape version of commercial_snapshot. v1 = 0049. */
  snapshot_version: number;
};

/** The listing gallery frozen at purchase (migration 0049). Immutable rows;
 *  URLs are protected from media GC while referenced here. */
export type OrderItemSnapshotImage = {
  id: string;
  order_item_id: string;
  url: string;
  alt: string | null;
  position: number;
  created_at: string;
};

/** Private ship-from/return address + handling config per seller (migration
 *  0051). Owner/admin read only; writes are service-role server actions.
 *  Never shown to buyers; never part of the commercial snapshot. */
export type SellerFulfillmentProfile = {
  seller_id: string;
  ship_from_name: string;
  company: string | null;
  street1: string;
  street2: string | null;
  city: string;
  state: string | null;
  postal_code: string;
  country: string;
  phone: string | null;
  return_name: string | null;
  return_street1: string | null;
  return_street2: string | null;
  return_city: string | null;
  return_state: string | null;
  return_postal_code: string | null;
  return_country: string | null;
  default_handling_days: number;
  /** Opaque EasyPost EndShipper reference (brief §10). Null until postage
   *  identity is provisioned. */
  easypost_end_shipper_id: string | null;
  address_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Shipment lifecycle (migration 0052) — guarded by trigger; mirrored in
 *  src/lib/domain/states.ts. */
export type ShipmentStatus =
  | "pending"
  | "label_purchased"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "returned_to_sender"
  | "cancelled"
  | "failed";

/** One parcel/label, outbound or return (migration 0052). The authoritative
 *  movement record; orders' carrier/tracking columns are the legacy mirror.
 *  label_reference and provider internals are NOT client-readable. */
export type Shipment = {
  id: string;
  order_id: string;
  direction: "outbound" | "return";
  return_id: string | null;
  provider: string | null;
  provider_shipment_id: string | null;
  provider_tracker_id: string | null;
  fulfillment_type: "drvn_shipping" | "seller_arranged";
  carrier: string | null;
  service: string | null;
  status: ShipmentStatus;
  tracking_code: string | null;
  label_reference: string | null;
  quoted_cents: number | null;
  purchased_cents: number | null;
  insured_value_cents: number | null;
  signature_required: boolean;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ShipmentItem = {
  shipment_id: string;
  order_item_id: string;
};

/** Lightweight tracking history (migration 0052). provider_event_ref is the
 *  webhook dedupe identity. */
export type ShipmentEvent = {
  id: string;
  shipment_id: string;
  provider_event_ref: string | null;
  status: string;
  description: string | null;
  occurred_at: string;
  city: string | null;
  state: string | null;
  country: string | null;
  created_at: string;
};

/** Signed payout-affecting ledger rows (migration 0052, brief §17): label
 *  costs ≤ 0, refunds ≥ 0. Append-only; voided_at stamps once. */
export type SellerAdjustment = {
  id: string;
  seller_id: string | null;
  order_id: string | null;
  shipment_id: string | null;
  return_id: string | null;
  kind: "outbound_label" | "return_label" | "label_refund" | "insurance";
  amount_cents: number;
  currency: string;
  external_reference: string | null;
  description: string | null;
  created_at: string;
  voided_at: string | null;
};

/** Server-held DRVN Shipping quote (migration 0053). Deny-all RLS — clients
 *  only ever hold the opaque id; amounts are re-read server-side at pay. */
export type ShippingRateQuote = {
  id: string;
  buyer_id: string | null;
  listing_id: string;
  provider: string;
  provider_shipment_id: string;
  rate_ref: string;
  carrier: string;
  service: string;
  service_label: string;
  amount_cents: number;
  currency: string;
  est_delivery_days: number | null;
  destination_hash: string;
  parcel: Json;
  consumed_order_id: string | null;
  expires_at: string;
  created_at: string;
};

/** Single-use pickup pass per order (migration 0054). Hashes only; RLS
 *  deny-all — minted and redeemed exclusively through server actions. */
export type PickupConfirmation = {
  order_id: string;
  token_hash: string;
  code_hash: string;
  attempts: number;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_by: string | null;
  created_at: string;
};

/** Return/RMA lifecycle (migration 0055) — guarded by trigger; mirrored in
 *  src/lib/domain/states.ts. */
export type ReturnStatus =
  | "requested"
  | "approved"
  | "awaiting_shipment"
  | "in_transit"
  | "delivered"
  | "received"
  | "completed"
  | "rejected"
  | "expired"
  | "cancelled"
  | "escalated";

/** One RMA (migration 0055): authorizes goods moving back and — on
 *  completion — a refund through the 0026 engine. Deadlines are frozen on
 *  the row; entitlement is agreed at approval and never recomputed. */
export type OrderReturn = {
  id: string;
  order_id: string;
  requested_by: string | null;
  return_type: "protection" | "shop_policy";
  reason: string | null;
  responsibility: "buyer" | "seller";
  status: ReturnStatus;
  requested_at: string;
  approved_at: string | null;
  /** Buyer must ship by this or the return expires (§27). */
  ship_by: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  /** Seller confirms/objects by this or the agreed refund proceeds (§27). */
  seller_respond_by: string | null;
  received_at: string | null;
  completed_at: string | null;
  refund_amount_cents: number | null;
  label_deduction_cents: number;
  refund_operation_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ReturnItem = {
  return_id: string;
  order_item_id: string;
  quantity: number;
  reason: string | null;
  inspection_status: "pending" | "ok" | "mismatch";
  inspection_note: string | null;
};

/** One-to-one shop extension of a profile (migration 0056). Public-readable;
 *  writes service-role only, verification admin-granted. */
export type ShopProfile = {
  profile_id: string;
  verification_status: "unverified" | "verified";
  returns_accepted: boolean;
  /** Predefined windows only: 14 | 30 | 60. */
  return_window_days: number;
  created_at: string;
  updated_at: string;
};

/** Photos either party attaches to a dispute (migration 0024). */
export type DisputeEvidence = {
  id: string;
  order_id: string;
  uploader_id: string | null;
  url: string;
  /** Bucket-relative object path ('{uploader_uid}/{file}'), 0027 — the
   *  private-bucket storage RLS policy and signEvidenceUrls() key off this
   *  rather than parsing `url`. Backfilled for pre-0027 rows. */
  storage_path: string | null;
  note: string | null;
  created_at: string;
};

// ---------- Fitment (migration 0025) ----------

export type VehicleMake = {
  id: number;
  name: string;
  models_fetched_at: string | null;
  created_at: string;
};

export type VehicleModel = {
  id: number;
  make_id: number;
  name: string;
  created_at: string;
};

/** The seller's structured fitment claim. Always presented as seller-stated. */
export type ListingFitment = {
  id: string;
  listing_id: string;
  make: string;
  model: string;
  year_start: number | null;
  year_end: number | null;
  created_at: string;
};

/** Extra identifiers a seller supplies for one listing ("also known as",
 *  migration 0042). Discovery-only — search matches these compacts. */
export type ListingPartNumber = {
  id: string;
  listing_id: string;
  number: string;
  /** Generated: lowercase, separators stripped — the searchable form. */
  number_compact: string;
  created_at: string;
};

/** INTERNAL interchange graph (0042): relationships between part-number
 *  compacts, read by the search identifier lane. Service-role only —
 *  no user manages or sees this. */
export type PartNumberLink = {
  id: string;
  from_compact: string;
  to_compact: string;
  kind:
    | "alternate"
    | "supersedes"
    | "superseded_by"
    | "aftermarket_equivalent"
    | "interchange"
    | "same_product";
  source: string;
  created_at: string;
};

/** A claimable unit of admin work over a dispute or report (migration 0046).
 *  Created and resolved by domain triggers; claim/priority/labels are the
 *  admin-mutable surface. */
export type OpsCase = {
  id: string;
  kind: "dispute" | "report";
  status: "open" | "claimed" | "resolved";
  priority: "normal" | "high";
  assigned_to: string | null;
  order_id: string | null;
  report_id: string | null;
  summary: string;
  labels: string[];
  opened_at: string;
  resolved_at: string | null;
  updated_at: string;
};

/** One pin on a car's showcase image (migration 0045). `label` is a display
 *  snapshot; mod_item_id links the real build entry while it exists. */
export type CarHotspot = {
  id: string;
  car_id: string;
  image_url: string;
  x: number;
  y: number;
  mod_item_id: string | null;
  label: string;
  created_at: string;
};

/** A kept marketplace state (migration 0044). `params` mirrors the
 *  /marketplace query string; `alert` is the separate, explicit opt-in. */
export type SavedSearch = {
  id: string;
  user_id: string;
  name: string;
  params: Record<string, string>;
  alert: boolean;
  last_checked_at: string | null;
  last_matched_at: string | null;
  created_at: string;
};

/** Client-side storage upload awaiting a DB reference (migration 0029).
 *  `consumed_at` is stamped when a persisting action saves the URL; rows
 *  still unconsumed after 48h are GC'd along with their storage objects. */
export type StagedUpload = {
  id: string;
  owner_id: string;
  bucket: string;
  path: string;
  url: string;
  created_at: string;
  consumed_at: string | null;
};

export type Payment = {
  id: string;
  order_id: string;
  provider: string;
  provider_reference: string | null;
  status: "pending" | "requires_action" | "succeeded" | "failed" | "refunded" | "partially_refunded";
  amount_cents: number;
  refunded_cents: number;
  currency: string;
  idempotency_key: string | null;
  failure_reason: string | null;
  raw: Json;
  created_at: string;
  updated_at: string;
};

export type OfferStatus = "open" | "countered" | "accepted" | "declined" | "withdrawn" | "expired";

export type Offer = {
  id: string;
  listing_id: string;
  buyer_id: string;
  amount_cents: number;
  counter_amount_cents: number | null;
  countered_at: string | null;
  expires_at: string | null;
  responded_at: string | null;
  status: OfferStatus;
  created_at: string;
  updated_at: string;
};

export type Review = {
  id: string;
  order_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  body: string | null;
  created_at: string;
};

export type ListingQuestion = {
  id: string;
  listing_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
};

export type Message = {
  id: string;
  /** Nullable since 0031: an order-context message may outlive its listing. */
  listing_id: string | null;
  offer_id: string | null;
  /** Post-sale threads hang off the order, so buy-now purchases have a channel. */
  order_id: string | null;
  /** Trigger-stamped pointer to the materialised thread (migration 0031). */
  conversation_id: string | null;
  sender_id: string;
  recipient_id: string;
  body: string;
  /** 'event' = a lifecycle note (dispute, pickup, return) written by the
   *  server; clients can only insert 'message' (20260928140000). */
  kind: "message" | "event";
  /** Private `message-photos` paths, `<sender>/<recipient>/<file>`, max 4. */
  attachments: string[];
  read_at: string | null;
  created_at: string;
};

/**
 * One row per PAIR of people (20260928140000; per order/offer before that).
 * participant_a < participant_b. The order/offer a message is about lives on
 * the message. Written exclusively by the message triggers; clients select.
 */
export type Conversation = {
  id: string;
  participant_a: string;
  participant_b: string;
  created_at: string;
  last_message_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
};

/** Trigger-maintained per-user unread counter (migration 0031). */
export type ConversationUnread = {
  conversation_id: string;
  user_id: string;
  unread_count: number;
};

export type Notification = {
  id: string;
  user_id: string;
  kind: string;
  section: "engagement" | "marketplace";
  title: string;
  body: string | null;
  href: string | null;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
};

// ---------- Admin substrate (migration 0018) ----------

export type AdminUser = {
  user_id: string;
  note: string | null;
  /** 'admin' acts, 'viewer' reads (migration 0023). */
  role: "admin" | "viewer";
  created_at: string;
};

export type AdminAuditSubjectType = "order" | "listing" | "user" | "report" | "dispute" | "payment" | "product_review" | "agent";

export type AdminAuditLogEntry = {
  id: number;
  actor_id: string;
  action: string;
  subject_type: AdminAuditSubjectType;
  subject_id: string;
  order_id: string | null;
  reason: string;
  metadata: Json;
  created_at: string;
};

export type ReportReason =
  | "prohibited_item"
  | "counterfeit"
  | "stolen_goods"
  | "scam_or_fraud"
  | "offensive_content"
  | "wrong_category"
  | "other";

export type Report = {
  id: string;
  reporter_id: string | null;
  /** 'post' and 'comment' since 20260928182300 (a post, or a reply on one). */
  subject_type: "listing" | "user" | "post" | "comment";
  subject_id: string;
  reason: ReportReason;
  detail: string | null;
  status: "open" | "actioned" | "dismissed";
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};

// ---------- Money infrastructure (migration 0019) ----------

export type WebhookEvent = {
  id: string;
  type: string;
  received_at: string;
  processed_at: string | null;
  /** Raw Stripe event, kept for console drill-in and replay (0023). Null for
   *  events recorded before payload retention. */
  payload: unknown | null;
};

export type TransferIntentStatus =
  | "holding"
  | "ready"
  | "processing"
  | "transferred"
  | "blocked_unpayable"
  | "failed"
  | "cancelled";

export type TransferIntent = {
  order_id: string;
  seller_id: string | null;
  amount_cents: number;
  currency: string;
  status: TransferIntentStatus;
  available_at: string | null;
  transfer_reference: string | null;
  /** The charge the transfer draws on (migration 0020). */
  source_transaction: string | null;
  /** Frozen at dispatch (20260905173052): what the transfer actually sent. */
  dispatch_amount_cents: number | null;
  attempts: number;
  last_error: string | null;
  /** Lease fields (0026): who claimed the row and until when. */
  locked_at: string | null;
  locked_by: string | null;
  lease_expires_at: string | null;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  created_at: string;
  updated_at: string;
};

// ---------- Listing imports (migration 0047) ----------

export type ListingImportStatus =
  | "pending"
  | "fetching"
  | "extracting"
  | "importing_media"
  | "ready"
  | "failed"
  | "consumed"
  | "expired";

/** One durable import job — a row IS the state machine (0047). `normalized_source`
 *  and `extracted` are the DRVN-owned stage payloads (validated server-side,
 *  never raw crawler output); both are cleared by the retention sweep once the
 *  import reaches a terminal state. */
export type ListingImport = {
  id: string;
  user_id: string;
  source_mode: "url" | "paste";
  source_adapter: string | null;
  source_url: string | null;
  canonical_url: string | null;
  source_domain: string | null;
  status: ListingImportStatus;
  attempts: number;
  lease_expires_at: string | null;
  normalized_source: Json | null;
  extracted: Json | null;
  imported_images: Json | null;
  selected_item: number | null;
  error_code: string | null;
  error_detail: string | null;
  listing_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  consumed_at: string | null;
  expires_at: string;
};

// ---------- Money durability (migration 0026) ----------

export type RefundOperationStatus =
  | "requested"
  | "provider_pending"
  | "provider_succeeded"
  | "effects_pending"
  | "reversal_pending"
  | "completed"
  | "failed"
  | "recovery_required";

export type RefundOperation = {
  id: string;
  order_id: string;
  payment_reference: string | null;
  amount_cents: number;
  currency: string;
  remaining_before_cents: number;
  reason: string;
  requested_by: string;
  actor_role: string;
  idempotency_key: string;
  refund_reference: string | null;
  reversal_reference: string | null;
  reversal_due_cents: number | null;
  status: RefundOperationStatus;
  external: boolean;
  resolve_dispute: boolean;
  dispute_outcome: string | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  recovery_id: string | null;
  created_at: string;
  updated_at: string;
  provider_completed_at: string | null;
  effects_completed_at: string | null;
  reversal_completed_at: string | null;
};

export type AdminAlertOutboxRow = {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  order_id: string | null;
  amount_cents: number | null;
  payload: Json;
  dedup_key: string | null;
  status: "pending" | "delivered" | "failed" | "disabled";
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
};

/** Scheduler configuration (migration 0020) — service-role only. */
export type JobConfig = {
  key: string;
  value: string;
  updated_at: string;
};

export type PaymentRecoveryKind =
  | "reversal_failed"
  | "refund_failed"
  | "partial_refund_unattributed"
  | "transfer_after_refund"
  | "negative_balance"
  | "capture_unresolved"
  | "transfer_unresolved"
  | "refund_lifecycle_unresolved"
  | "refund_late_failure";

export type PaymentRecovery = {
  id: string;
  order_id: string | null;
  kind: PaymentRecoveryKind;
  amount_cents: number | null;
  detail: string | null;
  status: "open" | "recovered" | "written_off";
  created_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
};

/** One row of the Explore timeline view (migration 0032) — a UNION of
 *  public cars, published activity posts, and active listings, ordered by
 *  `happened_at`. security_invoker, so RLS on the underlying tables applies. */
export type FeedEvent = {
  kind: "car" | "update" | "part";
  id: string;
  happened_at: string;
  /** The car the event hangs off: itself, the post's car, or the listing's
   *  source car (null for listings without one, and for carless posts). */
  car_id: string | null;
  /** Whose event it is — the car's owner, the post's author, the seller.
   *  Added by 198000 so Local (H-2) can ask the timeline "near me". */
  owner_id: string;
};

/** Shape returned by the `purchase_begin` RPC. */
export type PurchaseBeginResult = {
  orders: {
    order_id: string;
    seller_id: string;
    currency: string;
    subtotal_cents: number;
    shipping_cents: number;
    platform_fee_cents: number;
    total_cents: number;
    listing_ids: string[];
  }[];
  skipped: { listing_id: string; reason: string }[];
};

/** One seller-ledger row from the `seller_listing_stats` RPC (0030). */
export type SellerListingStat = {
  id: string;
  title: string;
  part_number: string | null;
  price_cents: number;
  status: ListingStatus;
  view_count: number;
  created_at: string;
  source_car_id: string | null;
  /** First listing image by position, or null for an unphotographed listing. */
  cover_url: string | null;
  watch_count: number;
  /** Best live ('open'/'countered') offer, counter beating the original. */
  top_offer_cents: number | null;
  /** Soonest expiry among live offers — the row's countdown. */
  soonest_offer_expiry: string | null;
  /** Root questions with no reply pointing at them. */
  unanswered_questions: number;
  /** Window count of the whole filtered register, repeated on every row. */
  total_count: number;
};

/** Single-row chip counts from the `seller_register_tally` RPC (0030). */
export type SellerRegisterTally = {
  all_count: number;
  live_count: number;
  offer_count: number;
  draft_count: number;
  paused_count: number;
  reserved_count: number;
  archived_count: number;
  sold_count: number;
};

/** Domain refinements for checked status values and structured JSON only.
 * Columns, inserts, updates, foreign keys and RPC signatures come from generation. */
type DomainRows = {
  profiles: Profile;
  account_emails: AccountEmail;
  cars: Car;
  car_images: CarImage;
  activity_posts: ActivityPost;
  activity_images: ActivityImage;
  activity_reactions: ActivityReaction;
  activity_comments: ActivityComment;
  listings: Listing;
  listing_images: ListingImage;
  mod_items: ModItem;
  saves: Save;
  likes: Like;
  follows: Follow;
  orders: Order;
  order_items: OrderItem;
  order_item_snapshot_images: OrderItemSnapshotImage;
  seller_fulfillment_profiles: SellerFulfillmentProfile;
  shipments: Shipment;
  shipment_items: ShipmentItem;
  pickup_confirmations: PickupConfirmation;
  shipping_rate_quotes: ShippingRateQuote;
  shipment_events: ShipmentEvent;
  seller_adjustments: SellerAdjustment;
  returns: OrderReturn;
  return_items: ReturnItem;
  shop_profiles: ShopProfile;
  payments: Payment;
  offers: Offer;
  reviews: Review;
  listing_questions: ListingQuestion;
  messages: Message;
  conversations: Conversation;
  conversation_unreads: ConversationUnread;
  notifications: Notification;
  admin_users: AdminUser;
  admin_audit_log: AdminAuditLogEntry;
  reports: Report;
  webhook_events: WebhookEvent;
  transfer_intents: TransferIntent;
  payment_recoveries: PaymentRecovery;
  refund_operations: RefundOperation;
  admin_alert_outbox: AdminAlertOutboxRow;
  job_config: JobConfig;
  dispute_evidence: DisputeEvidence;
  vehicle_makes: VehicleMake;
  vehicle_models: VehicleModel;
  catalog_makes: CatalogMake;
  catalog_models: CatalogModel;
  listing_fitments: ListingFitment;
  listing_part_numbers: ListingPartNumber;
  saved_searches: SavedSearch;
  car_hotspots: CarHotspot;
  ops_cases: OpsCase;
  part_number_links: PartNumberLink;
  staged_uploads: StagedUpload;
  listing_imports: ListingImport;
};
type GeneratedTables = GeneratedDatabase["public"]["Tables"];
type GeneratedFunctions = GeneratedDatabase["public"]["Functions"];
type RefinedRow<K extends keyof GeneratedTables> = {
  [C in keyof GeneratedTables[K]["Row"]]: K extends keyof DomainRows
    ? C extends keyof DomainRows[K] ? DomainRows[K][C] : GeneratedTables[K]["Row"][C]
    : GeneratedTables[K]["Row"][C];
};
/** PostgreSQL function argument nullability is not emitted by Supabase's generator.
 * These explicit domain exceptions match the verified SQL contracts. */
type NullableArgs = {
  beta_access_status: "p_user_id";
  begin_admin_external_operation: "p_order";
  begin_refund_operation: "p_amount_cents" | "p_payment_reference" | "p_refund_reference";
  begin_request_refund_operation: "p_amount_cents";
  complete_transfer_intent: "p_operation_key";
  release_transfer_intent: "p_attempts" | "p_last_error" | "p_next_attempt_at";
  release_seller_carry_payout: "p_attempts" | "p_last_error" | "p_next_attempt_at";
  record_refund_provider_event: "p_operation_id" | "p_order_id" | "p_payment_reference" | "p_balance_transaction" | "p_failure_balance_transaction" | "p_failure_reason" | "p_pending_reason";
  settle_payment_capture: "p_source";
  purchase_begin: "p_idempotency_key";
  purchase_finalize: "p_reference" | "p_failure_reason";
  finish_reservation_expiry: "p_reference";
};
type RpcArgs<K extends keyof GeneratedFunctions> = GeneratedFunctions[K]["Args"] extends never ? Record<string, never> : {
  [A in keyof GeneratedFunctions[K]["Args"]]: GeneratedFunctions[K]["Args"][A] | (K extends keyof NullableArgs ? A extends NullableArgs[K] ? null : never : never);
};
export type Database = {
  public: Omit<GeneratedDatabase["public"], "Tables" | "Functions"> & {
    Tables: { [K in keyof GeneratedTables]: Omit<GeneratedTables[K], "Row"> & { Row: RefinedRow<K> } };
    Functions: { [K in keyof GeneratedFunctions]: {
      Args: RpcArgs<K>;
      Returns: K extends "seller_listing_stats" ? SellerListingStat[] : GeneratedFunctions[K]["Returns"];
    } };
  };
};
