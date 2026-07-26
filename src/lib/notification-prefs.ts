/**
 * Notification preference keys — all default to enabled when unset. Grouped to
 * mirror the two sections on the Notifications page (PRD §8.10): Profile
 * (engagement) first, Marketplace second.
 *
 * Widened alongside migration 0009: the old list covered four events, so the
 * majority of what the product now raises — questions, comments, reviews,
 * dispatch updates, messages — had no toggle, and `offers_sales` rendered a
 * checkbox that governed nothing.
 */
export const NOTIFICATION_PREFS = [
  {
    key: "profile_follows",
    group: "Profile",
    label: "New followers",
    hint: "Someone follows your profile",
  },
  {
    key: "car_engagement",
    group: "Profile",
    label: "Car follows & saves",
    hint: "Someone follows or saves one of your cars",
  },
  {
    key: "comments",
    group: "Profile",
    label: "Comments & reactions",
    hint: "Someone responds to one of your build updates",
  },
  {
    key: "reviews",
    group: "Profile",
    label: "Reviews",
    hint: "Someone rates you after a completed trade",
  },
  {
    key: "listing_saves",
    group: "Marketplace",
    label: "Listing saves",
    hint: "Someone saves one of your listings",
  },
  {
    key: "offers_sales",
    group: "Marketplace",
    label: "Offers & sales",
    hint: "New offers, counters, accepted offers and sold items",
  },
  {
    key: "questions",
    group: "Marketplace",
    label: "Questions",
    hint: "A buyer asks about one of your parts",
  },
  {
    key: "order_updates",
    group: "Marketplace",
    label: "Dispatch & delivery",
    hint: "Payment, dispatch, delivery and cancellations on your orders",
  },
  {
    key: "messages",
    group: "Marketplace",
    label: "Messages",
    hint: "Someone messages you about an offer or an order",
  },
] as const;

export const NOTIFICATION_PREF_GROUPS = ["Profile", "Marketplace"] as const;

export type NotificationPrefKey = (typeof NOTIFICATION_PREFS)[number]["key"];
export type NotificationPrefs = Partial<Record<NotificationPrefKey, boolean>>;

const KEYS = new Set<string>(NOTIFICATION_PREFS.map((p) => p.key));

export function prefEnabled(prefs: unknown, key: NotificationPrefKey): boolean {
  if (!prefs || typeof prefs !== "object") return true;
  const value = (prefs as Record<string, unknown>)[key];
  return value !== false;
}

/**
 * Maps a notification `kind` (set by the DB triggers) onto the preference that
 * governs it. Unknown kinds are always shown — a new event type should surface
 * rather than silently vanish because nobody added a toggle for it.
 */
export function prefKeyForKind(kind: string): NotificationPrefKey | null {
  const key = (() => {
    if (kind === "follow") return "profile_follows";
    if (kind === "save") return "car_engagement";
    if (kind === "comment" || kind === "reaction") return "comments";
    if (kind === "review") return "reviews";
    if (kind === "question") return "questions";
    if (kind === "message") return "messages";
    if (kind.startsWith("offer")) return "offers_sales";
    if (kind === "order_sold" || kind === "order_paid") return "offers_sales";
    if (kind.startsWith("order")) return "order_updates";
    return null;
  })();

  return key && KEYS.has(key) ? (key as NotificationPrefKey) : null;
}
