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
  { kind: "car_follow", section: "engagement", pref: "car_engagement", source: "trigger", description: "Someone followed one of your cars (20260928160000)." },
  { kind: "save", section: "engagement", pref: "car_engagement", source: "trigger", description: "Someone saved your car, profile or post." },
  { kind: "comment", section: "engagement", pref: "comments", source: "trigger", description: "A comment on your build update." },
  { kind: "reaction", section: "engagement", pref: "comments", source: "trigger", description: "A reaction on your build update." },
  { kind: "review", section: "engagement", pref: "reviews", source: "trigger", description: "A review after a completed trade." },
  { kind: "listing_save", section: "marketplace", pref: "listing_saves", source: "trigger", description: "Someone saved your listing." },
  { kind: "question", section: "marketplace", pref: "questions", source: "trigger", description: "A question on one of your parts." },
  { kind: "offer_new", section: "marketplace", pref: "offers_sales", source: "trigger", description: "A new offer on your listing." },
  { kind: "offer_countered", section: "marketplace", pref: "offers_sales", source: "trigger", description: "The seller countered your offer — opens the offer." },
  { kind: "offer_declined", section: "marketplace", pref: "offers_sales", source: "trigger", description: "The seller declined your offer — opens the offer." },
  { kind: "offer_accepted", section: "marketplace", pref: "offers_sales", source: "app", description: "The seller accepted your offer — opens checkout (offer-actions.ts; the trigger no longer writes a second one)." },
  { kind: "offer_counter_accepted", section: "marketplace", pref: "offers_sales", source: "trigger", description: "The buyer accepted your counter — opens the order." },
  { kind: "offer_withdrawn", section: "marketplace", pref: "offers_sales", source: "trigger", description: "An offer was withdrawn." },
  { kind: "order_sold", section: "marketplace", pref: "offers_sales", source: "trigger", description: "Your part sold." },
  { kind: "order_paid", section: "marketplace", pref: "offers_sales", source: "trigger", description: "Payment confirmed on an order." },
  { kind: "order_shipped", section: "marketplace", pref: "order_updates", source: "trigger", description: "Your order shipped." },
  { kind: "order_delivered", section: "marketplace", pref: "order_updates", source: "trigger", description: "Delivery confirmed." },
  { kind: "order_disputed", section: "marketplace", pref: "order_updates", source: "trigger", description: "A dispute opened on an order." },
  { kind: "dispute_resolved", section: "marketplace", pref: "order_updates", source: "trigger", description: "A dispute was resolved." },
  { kind: "dispute_escalated", section: "marketplace", pref: "order_updates", source: "trigger", description: "A dispute was escalated to support." },
  { kind: "report_reviewed", section: "engagement", pref: null, source: "app", description: "A report you filed was reviewed (marketplace section for listing/user reports)." },
  { kind: "post_removed", section: "engagement", pref: null, source: "app", description: "Moderation removed one of your posts; its text is kept in the audit log." },
  { kind: "comment_removed", section: "engagement", pref: null, source: "app", description: "Moderation removed one of your replies." },
  { kind: "account_suspended", section: "marketplace", pref: null, source: "app", description: "Your account was suspended, with the reason. Posting, replying, messaging, Q&A and offers are blocked." },
  { kind: "account_restored", section: "marketplace", pref: null, source: "app", description: "Your suspension was lifted." },
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
