// Hand-written types for the v3 schema (supabase/migrations/0001_v3_schema.sql).
// Regenerate with `supabase gen types typescript` once the CLI is wired up.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

/* Relationships drive supabase-js embed typing (`select("*, listings(...)")`).
   Declared per-table only where an embed is actually used — the DB has the
   real FK either way; this is purely for the type layer. */
type Table<Row, Required extends keyof Row = never, Rels extends Relationship[] = []> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: Rels;
};

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
  /** Moderation suspension (migration 0018). Service-role-written; unreadable
   *  by client roles — read via is_suspended() or the service client. */
  suspended_at: string | null;
  suspended_reason: string | null;
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
  car_id: string;
  author_id: string;
  title: string;
  intro: string | null;
  body: Json;
  video_url: string | null;
  published_at: string | null;
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
  price_cents: number;
  /** Seller-set flat shipping, charged on top of the asking price. */
  shipping_cents: number;
  allows_collection: boolean;
  /** Offers below this are refused before the seller sees them. */
  offer_floor_cents: number | null;
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
  created_at: string;
  updated_at: string;
};

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
  read_at: string | null;
  created_at: string;
};

/**
 * One row per message channel (migration 0031) — the durable form of what the
 * inbox used to derive by scanning `messages`. Written exclusively by the
 * message triggers; clients only ever select.
 */
export type Conversation = {
  id: string;
  type: "order" | "offer";
  order_id: string | null;
  offer_id: string | null;
  listing_id: string | null;
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

export type AdminAuditSubjectType = "order" | "listing" | "user" | "report" | "dispute" | "payment";

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
  subject_type: "listing" | "user";
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
  | "negative_balance";

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
   *  source car (null for listings without one). */
  car_id: string | null;
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

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, "id">;
      account_emails: Table<AccountEmail, "user_id" | "email">;
      cars: Table<Car, "owner_id" | "slug" | "name">;
      car_images: Table<CarImage, "car_id" | "url">;
      activity_posts: Table<ActivityPost, "car_id" | "author_id" | "title">;
      activity_images: Table<ActivityImage, "post_id" | "url">;
      activity_reactions: Table<ActivityReaction, "post_id" | "user_id" | "emoji">;
      activity_comments: Table<ActivityComment, "post_id" | "author_id" | "body">;
      listings: Table<Listing, "seller_id" | "title" | "category" | "price_cents">;
      listing_images: Table<ListingImage, "listing_id" | "url">;
      mod_items: Table<ModItem, "car_id">;
      saves: Table<Save, "user_id" | "target_type" | "target_id">;
      likes: Table<Like, "user_id" | "target_type" | "target_id">;
      follows: Table<Follow, "follower_id" | "target_type" | "target_id">;
      orders: Table<Order, "buyer_id" | "seller_id">;
      order_items: Table<
        OrderItem,
        "order_id" | "price_cents",
        [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ]
      >;
      payments: Table<Payment, "order_id" | "amount_cents">;
      offers: Table<
        Offer,
        "listing_id" | "buyer_id" | "amount_cents",
        [
          {
            foreignKeyName: "offers_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ]
      >;
      reviews: Table<Review, "order_id" | "reviewer_id" | "reviewee_id" | "rating">;
      listing_questions: Table<ListingQuestion, "listing_id" | "author_id" | "body">;
      messages: Table<Message, "sender_id" | "recipient_id" | "body">;
      conversations: Table<Conversation, "type" | "participant_a" | "participant_b">;
      conversation_unreads: Table<ConversationUnread, "conversation_id" | "user_id">;
      notifications: Table<Notification, "user_id" | "kind" | "section" | "title">;
      admin_users: Table<AdminUser, "user_id">;
      admin_audit_log: Table<AdminAuditLogEntry, "actor_id" | "action" | "subject_type" | "subject_id" | "reason">;
      reports: Table<Report, "subject_type" | "subject_id" | "reason">;
      webhook_events: Table<WebhookEvent, "id" | "type">;
      transfer_intents: Table<TransferIntent, "order_id" | "amount_cents" | "currency">;
      payment_recoveries: Table<PaymentRecovery, "kind">;
      refund_operations: Table<
        RefundOperation,
        "order_id" | "amount_cents" | "currency" | "remaining_before_cents" | "requested_by" | "idempotency_key"
      >;
      admin_alert_outbox: Table<AdminAlertOutboxRow, "kind" | "title">;
      job_config: Table<JobConfig, "key" | "value">;
      dispute_evidence: Table<DisputeEvidence, "order_id" | "url">;
      vehicle_makes: Table<VehicleMake, "id" | "name">;
      vehicle_models: Table<VehicleModel, "make_id" | "name">;
      catalog_makes: Table<CatalogMake, "name">;
      catalog_models: Table<CatalogModel, "make_id" | "name">;
      listing_fitments: Table<ListingFitment, "listing_id" | "make" | "model">;
      listing_part_numbers: Table<ListingPartNumber, "listing_id" | "number">;
      part_number_links: Table<PartNumberLink, "from_compact" | "to_compact" | "kind">;
      staged_uploads: Table<StagedUpload, "owner_id" | "bucket" | "path" | "url">;
    };
    Views: {
      /** Explore timeline (migration 0032). Read-only; no Insert/Update. */
      feed_events: {
        Row: FeedEvent;
        Relationships: [];
      };
    };
    Functions: {
      /** Claims listings and creates pending orders in one transaction (0007). */
      purchase_begin: {
        Args: {
          p_buyer_id: string;
          p_listing_ids: string[];
          p_idempotency_key?: string | null;
          p_reservation_window?: string;
        };
        Returns: PurchaseBeginResult;
      };
      /** Settles a claimed order — the future webhook entry point (0007). */
      purchase_finalize: {
        Args: {
          p_order_id: string;
          p_success: boolean;
          p_provider?: string;
          p_reference?: string | null;
          p_failure_reason?: string | null;
        };
        /** { applied, reason?, status? } — `applied:false` means already settled. */
        Returns: { applied: boolean; reason?: string; status?: string };
      };
      offer_accept_begin: {
        Args: {
          p_offer_id: string;
          p_seller_id: string;
          p_reservation_window?: string;
        };
        Returns: string | null;
      };
      release_expired_reservations: {
        Args: Record<string, never>;
        Returns: { listings_released: number; orders_cancelled: number };
      };
      consume_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window: string };
        Returns: boolean;
      };
      search_listing_ids: {
        Args: { p_query: string };
        Returns: string[];
      };
      /** Ids of the caller's conversations matching q by preview, counterparty
       *  name, or message body — bounded at 50, RLS-scoped (0031). */
      search_user_messages: {
        Args: { p_query: string };
        Returns: string[];
      };
      /** Bumps a listing's public view counter. Callable by anyone. */
      bump_listing_view: {
        Args: { p_listing: string };
        Returns: undefined;
      };
      /** True when auth.uid() is a row in admin_users (migration 0018). */
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      /** 'admin' | 'viewer' for console members, null otherwise (0023). */
      admin_role: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      /** Raises unless the actor holds the full 'admin' role (0040). Called by
       *  auditedAction before every mutation — the DB-side admin boundary. */
      assert_admin_actor: {
        Args: { p_actor: string };
        Returns: undefined;
      };
      /** Atomically reserves a refund amount as a refund_operations row (0026). */
      begin_refund_operation: {
        Args: {
          p_order_id: string;
          p_amount_cents: number | null;
          p_reason: string;
          p_requested_by: string;
          p_actor_role: string;
          p_resolve_dispute: boolean;
          p_dispute_outcome: string | null;
          p_payment_reference: string | null;
          p_refund_reference?: string | null;
          p_external?: boolean;
        };
        Returns: Json;
      };
      /** Applies all internal refund effects in one transaction (0026). */
      settle_refund_operation: {
        Args: { p_operation_id: string };
        Returns: Json;
      };
      /** Leased, bounded transfer-intent claim under SKIP LOCKED (0026). */
      claim_transfer_intents: {
        Args: {
          p_worker: string;
          p_batch?: number;
          p_lease_seconds?: number;
          p_max_attempts?: number;
        };
        Returns: TransferIntent[];
      };
      /** One page of seller-ledger rows, filtered/sorted/counted in SQL (0030). */
      seller_listing_stats: {
        Args: {
          p_seller: string;
          p_register?: string;
          p_sort?: string;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: SellerListingStat[];
      };
      /** Register chip counts for the seller's ledger, one grouped scan (0030). */
      seller_register_tally: {
        Args: { p_seller: string };
        Returns: SellerRegisterTally[];
      };
      /** Buyer questions across the seller's whole catalog with no reply (0035). */
      seller_open_questions: {
        Args: { p_seller: string };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
