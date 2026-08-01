// Hand-written types for the v3 schema (supabase/migrations/0001_v3_schema.sql).
// Regenerate with `supabase gen types typescript` once the CLI is wired up.

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: [];
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
  target_type: "listing" | "car" | "profile";
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
  ship_country: string | null;
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
  /** Day-4 SLA escalation stamp (migration 0021). */
  dispute_escalated_at: string | null;
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
  created_at: string;
  updated_at: string;
};

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
  listing_id: string;
  offer_id: string | null;
  /** Post-sale threads hang off the order, so buy-now purchases have a channel. */
  order_id: string | null;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
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
  created_at: string;
  updated_at: string;
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

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, "id">;
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
      follows: Table<Follow, "follower_id" | "target_type" | "target_id">;
      orders: Table<Order, "buyer_id" | "seller_id">;
      order_items: Table<OrderItem, "order_id" | "price_cents">;
      payments: Table<Payment, "order_id" | "amount_cents">;
      offers: Table<Offer, "listing_id" | "buyer_id" | "amount_cents">;
      reviews: Table<Review, "order_id" | "reviewer_id" | "reviewee_id" | "rating">;
      listing_questions: Table<ListingQuestion, "listing_id" | "author_id" | "body">;
      messages: Table<Message, "listing_id" | "sender_id" | "recipient_id" | "body">;
      notifications: Table<Notification, "user_id" | "kind" | "section" | "title">;
      admin_users: Table<AdminUser, "user_id">;
      admin_audit_log: Table<AdminAuditLogEntry, "actor_id" | "action" | "subject_type" | "subject_id" | "reason">;
      reports: Table<Report, "subject_type" | "subject_id" | "reason">;
      webhook_events: Table<WebhookEvent, "id" | "type">;
      transfer_intents: Table<TransferIntent, "order_id" | "amount_cents" | "currency">;
      payment_recoveries: Table<PaymentRecovery, "kind">;
      job_config: Table<JobConfig, "key" | "value">;
    };
    Views: Record<string, never>;
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
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
