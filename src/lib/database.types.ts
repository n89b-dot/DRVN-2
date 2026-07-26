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

export type Listing = {
  id: string;
  seller_id: string;
  source_car_id: string | null;
  title: string;
  description: string | null;
  category: string;
  subcategory: string | null;
  condition: "new" | "like_new" | "used" | "for_parts" | null;
  price_cents: number;
  currency: string;
  location: string | null;
  compatibility_notes: string | null;
  status: "draft" | "active" | "sold" | "archived";
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

export type Order = {
  id: string;
  buyer_id: string;
  seller_id: string;
  status: "pending" | "paid" | "shipped" | "completed" | "cancelled" | "refunded";
  subtotal_cents: number;
  platform_fee_cents: number;
  total_cents: number;
  currency: string;
  created_at: string;
  updated_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  listing_id: string;
  price_cents: number;
  quantity: number;
};

export type Offer = {
  id: string;
  listing_id: string;
  buyer_id: string;
  amount_cents: number;
  status: "open" | "accepted" | "declined" | "withdrawn" | "expired";
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
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
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
      order_items: Table<OrderItem, "order_id" | "listing_id" | "price_cents">;
      offers: Table<Offer, "listing_id" | "buyer_id" | "amount_cents">;
      reviews: Table<Review, "order_id" | "reviewer_id" | "reviewee_id" | "rating">;
      listing_questions: Table<ListingQuestion, "listing_id" | "author_id" | "body">;
      messages: Table<Message, "listing_id" | "sender_id" | "recipient_id" | "body">;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
