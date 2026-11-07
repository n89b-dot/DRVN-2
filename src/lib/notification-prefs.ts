/**
 * Notification preference keys — all default to enabled when unset. Grouped to
 * mirror the two sections on the Notifications page (PRD §8.10): Profile
 * (engagement) first, Marketplace second.
 *
 * Widened alongside migration 0009: the old list covered four events, so the
 * majority of what the product now raises — questions, comments, reviews,
 * dispatch updates — had no toggle, and `offers_sales` rendered a
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
    key: "saved_searches",
    group: "Marketplace",
    label: "Saved-search matches",
    hint: "New inventory matching a search you asked to be told about",
  },
  {
    // The email channel for the same matches (N78): one digest a day per
    // search at most. Governs no in-app kind; turning off the preference
    // above stops these emails too.
    key: "saved_search_emails",
    group: "Marketplace",
    label: "Saved-search emails",
    hint: "One email a day at most for each search, listing its new matches",
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
    // Someone following a car is build engagement, not a follow of you.
    if (kind === "car_follow") return "car_engagement";
    // A saved part is governed by the marketplace preference; a saved car or
    // profile by the engagement one.
    if (kind === "listing_save") return "listing_saves";
    if (kind === "save") return "car_engagement";
    if (kind === "comment" || kind === "reaction") return "comments";
    if (kind === "review") return "reviews";
    if (kind === "question") return "questions";
    if (kind.startsWith("offer")) return "offers_sales";
    if (kind === "order_sold" || kind === "order_paid") return "offers_sales";
    if (kind.startsWith("order")) return "order_updates";
    if (kind.startsWith("dispute")) return "order_updates";
    if (kind === "saved_search") return "saved_searches";
    return null;
  })();

  return key && KEYS.has(key) ? (key as NotificationPrefKey) : null;
}

/** Whether a notification of this kind is shown under these preferences —
 *  the one rule for the list, the bell badge and the "N unread" line. */
export function kindIsShown(prefs: unknown, kind: string): boolean {
  const key = prefKeyForKind(kind);
  return key ? prefEnabled(prefs, key) : true;
}

/** The kinds each preference governs, as `prefKeyForKind` decides them —
 *  exact kinds plus kind prefixes, minus exact kinds a prefix must not take. */
const PREF_KIND_RULES: Record<NotificationPrefKey, { kinds?: string[]; prefixes?: string[]; except?: string[] }> = {
  profile_follows: { kinds: ["follow"] },
  car_engagement: { kinds: ["car_follow", "save"] },
  comments: { kinds: ["comment", "reaction"] },
  reviews: { kinds: ["review"] },
  listing_saves: { kinds: ["listing_save"] },
  questions: { kinds: ["question"] },
  offers_sales: { kinds: ["order_sold", "order_paid"], prefixes: ["offer"] },
  // `order…` is dispatch and delivery except the two sale kinds above.
  order_updates: { prefixes: ["order", "dispute"], except: ["order_sold", "order_paid"] },
  saved_searches: { kinds: ["saved_search"] },
  saved_search_emails: {},
};

/**
 * `kindIsShown` as one PostgREST `or` filter, so muted kinds are left out by
 * the query itself and a page of results is a full page. Null when nothing
 * is muted. Pass it to `.or()`: the single `and(...)` term inside means
 * every condition holds.
 */
export function mutedKindFilter(prefs: unknown): string | null {
  const muted = NOTIFICATION_PREFS.map((p) => p.key).filter((key) => !prefEnabled(prefs, key));
  const exact = new Set<string>();
  const terms: string[] = [];
  for (const key of muted) {
    const rule = PREF_KIND_RULES[key];
    for (const kind of rule.kinds ?? []) exact.add(kind);
    for (const prefix of rule.prefixes ?? []) {
      // A prefix's exceptions stay visible unless they are muted themselves.
      const keep = (rule.except ?? []).filter((kind) => kindIsShown(prefs, kind));
      terms.push(
        keep.length
          ? `or(kind.not.like.${prefix}*,kind.in.(${keep.join(",")}))`
          : `kind.not.like.${prefix}*`
      );
    }
  }
  if (exact.size) terms.unshift(`kind.not.in.(${[...exact].join(",")})`);
  return terms.length ? `and(${terms.join(",")})` : null;
}
