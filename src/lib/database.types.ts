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
  headline: string | null;
  bio: string | null;
  location: string | null;
  links: Json;
  notification_prefs: Json;
  profile_type: "user" | "shop";
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
  | "archived";

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
  sold_at: string | null;
  reserved_until: string | null;
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
  created_at: string;
  updated_at: string;
};

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
        Returns: undefined;
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
        Returns: number;
      };
      consume_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window: string };
        Returns: boolean;
      };
      search_listing_ids: {
        Args: { p_query: string };
        Returns: string[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
