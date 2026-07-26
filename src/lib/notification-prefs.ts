/**
 * Notification preference keys — all default to enabled when unset. Grouped to
 * mirror the two sections on the Notifications page (PRD §8.10): Profile
 * (engagement) first, Marketplace second.
 */
export const NOTIFICATION_PREFS = [
  { key: "profile_follows", group: "Profile", label: "New followers", hint: "Someone follows your profile" },
  { key: "car_engagement", group: "Profile", label: "Car follows & saves", hint: "Someone follows or saves one of your cars" },
  { key: "listing_saves", group: "Marketplace", label: "Listing saves", hint: "Someone saves one of your listings" },
  { key: "offers_sales", group: "Marketplace", label: "Offers & sales", hint: "New offers, accepted offers, and sold items" },
] as const;

export const NOTIFICATION_PREF_GROUPS = ["Profile", "Marketplace"] as const;

export type NotificationPrefKey = (typeof NOTIFICATION_PREFS)[number]["key"];
export type NotificationPrefs = Partial<Record<NotificationPrefKey, boolean>>;

export function prefEnabled(prefs: unknown, key: NotificationPrefKey): boolean {
  if (!prefs || typeof prefs !== "object") return true;
  const value = (prefs as Record<string, unknown>)[key];
  return value !== false;
}
