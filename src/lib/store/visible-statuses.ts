/**
 * Which listing states a store shows, decided by who is looking (P-6).
 *
 * This is the whole security surface of the Parts tab, so it is one pure
 * function with a name rather than a condition spread across a query:
 *
 *   - **Public** sees active and sold. Sold matters — a store with twelve
 *     sold parts and two live ones is a different proposition from a brand
 *     new seller, and hiding the history would flatten them.
 *   - **The owner** also sees draft, paused and reserved, because those are
 *     the things they need to act on.
 *
 * What it is NOT is a URL parameter. `?status=draft` must never reveal a
 * draft: the allowed set comes from the session, and the tab the visitor
 * picked can only ever narrow it.
 */

export const PUBLIC_STORE_STATUSES = ["active", "sold"] as const;
export const OWNER_STORE_STATUSES = [
  "active",
  "sold",
  "draft",
  "paused",
  "reserved",
] as const;

/** `hidden` is the owner's own worklist: draft, paused and reserved. */
export type StoreTab = "active" | "sold" | "all" | "hidden";

/** States only the owner can ever be shown. */
const HIDDEN_STORE_STATUSES = ["draft", "paused", "reserved"];

export function allowedStoreStatuses(isOwner: boolean): string[] {
  return [...(isOwner ? OWNER_STORE_STATUSES : PUBLIC_STORE_STATUSES)];
}

/**
 * The statuses to actually query: the viewer's allowance, narrowed by the
 * tab they chose. An unknown tab falls back to "all" rather than erroring,
 * and narrowing can only ever intersect — never widen.
 */
export function storeStatusesFor(isOwner: boolean, tab: string | undefined): string[] {
  const allowed = allowedStoreStatuses(isOwner);
  const picked = parseStoreTab(tab, isOwner);
  if (picked === "active") return allowed.filter((s) => s === "active");
  if (picked === "sold") return allowed.filter((s) => s === "sold");
  if (picked === "hidden") return allowed.filter((s) => HIDDEN_STORE_STATUSES.includes(s));
  return allowed;
}

/**
 * A store opens on what is for sale: that is what a visitor came for, and it
 * is the number on the tab. `hidden` only exists for the owner — asked for
 * by anyone else it is the default, never an empty page that confirms there
 * is something to hide.
 */
export function parseStoreTab(value: string | undefined, isOwner = false): StoreTab {
  if (value === "sold" || value === "all") return value;
  if (value === "hidden" && isOwner) return "hidden";
  return "active";
}

/** The tabs this viewer is offered, in order. */
export function storeTabsFor(isOwner: boolean): { key: StoreTab; label: string }[] {
  return [
    { key: "active", label: "For sale" },
    { key: "sold", label: "Sold" },
    { key: "all", label: "All" },
    ...(isOwner ? [{ key: "hidden" as const, label: "Not live" }] : []),
  ];
}
