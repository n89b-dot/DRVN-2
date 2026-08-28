import { prefKeyForKind, type NotificationPrefKey } from "@/lib/notification-prefs";

/**
 * The notification-domain registry (brief §D): every kind DRVN raises, its
 * section, its governing preference and where it originates. The DB triggers
 * (0009 onward) remain the writers for reactive kinds; app-delivered kinds
 * (worker alerts) go through deliver.ts. Docs derive from this table — adding
 * a kind here is the one registration step.
 */

export type NotificationSection = "engagement" | "marketplace";

export type NotificationKind = {
  kind: string;
  section: NotificationSection;
  /** Governing preference (null = always shown). */
  pref: NotificationPrefKey | null;
  /** Who writes it: a database trigger, or app code via deliver(). */
  source: "trigger" | "app";
  description: string;
};

export const NOTIFICATION_KINDS: NotificationKind[] = [
  { kind: "follow", section: "engagement", pref: "profile_follows", source: "trigger", description: "Someone followed your profile." },
  { kind: "save", section: "engagement", pref: "car_engagement", source: "trigger", description: "Someone saved your car, profile or post." },
  { kind: "comment", section: "engagement", pref: "comments", source: "trigger", description: "A comment on your build update." },
  { kind: "reaction", section: "engagement", pref: "comments", source: "trigger", description: "A reaction on your build update." },
  { kind: "review", section: "engagement", pref: "reviews", source: "trigger", description: "A review after a completed trade." },
  { kind: "listing_save", section: "marketplace", pref: "listing_saves", source: "trigger", description: "Someone saved your listing." },
  { kind: "question", section: "marketplace", pref: "questions", source: "trigger", description: "A question on one of your parts." },
  { kind: "offer_new", section: "marketplace", pref: "offers_sales", source: "trigger", description: "A new offer on your listing." },
  { kind: "offer_response", section: "marketplace", pref: "offers_sales", source: "trigger", description: "Your offer was answered." },
  { kind: "offer_withdrawn", section: "marketplace", pref: "offers_sales", source: "trigger", description: "An offer was withdrawn." },
  { kind: "order_sold", section: "marketplace", pref: "offers_sales", source: "trigger", description: "Your part sold." },
  { kind: "order_paid", section: "marketplace", pref: "offers_sales", source: "trigger", description: "Payment confirmed on an order." },
  { kind: "order_shipped", section: "marketplace", pref: "order_updates", source: "trigger", description: "Your order shipped." },
  { kind: "order_delivered", section: "marketplace", pref: "order_updates", source: "trigger", description: "Delivery confirmed." },
  { kind: "order_disputed", section: "marketplace", pref: "order_updates", source: "trigger", description: "A dispute opened on an order." },
  { kind: "dispute_resolved", section: "marketplace", pref: "order_updates", source: "trigger", description: "A dispute was resolved." },
  { kind: "dispute_escalated", section: "marketplace", pref: "order_updates", source: "trigger", description: "A dispute was escalated to support." },
  { kind: "message", section: "marketplace", pref: "messages", source: "trigger", description: "A message on an offer or order thread." },
  { kind: "saved_search", section: "marketplace", pref: "saved_searches", source: "app", description: "New inventory matching a saved search with alerts on." },
];

/** Sanity: the registry's pref mapping and prefKeyForKind must agree. */
export function kindRegistryConsistent(): { kind: string; expected: string | null; got: string | null }[] {
  return NOTIFICATION_KINDS.map((entry) => ({
    kind: entry.kind,
    expected: entry.pref,
    got: prefKeyForKind(entry.kind),
  })).filter((row) => row.expected !== row.got);
}
