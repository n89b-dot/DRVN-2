/**
 * The register — one description of DRVN's navigation, read by the desktop
 * rail, the mobile index and the Marketplace-family subnav.
 *
 * Marketplace, Listings, Offers and Orders are one *family* (public storefront
 * → what I'm selling → what's being negotiated → what actually sold) but four
 * distinct product surfaces with their own routes, server loading and deep
 * links. The family is a grouping in the navigation, not a tab component.
 */

export type NavRoute = { href: string; label: string; note: string };

/** The Marketplace family, in transaction order. */
export const MARKETPLACE_FAMILY: NavRoute[] = [
  { href: "/marketplace", label: "Marketplace", note: "Used parts off modified cars" },
  { href: "/listings", label: "Listings", note: "Views, watchers and offers on what you're selling" },
  { href: "/offers", label: "Offers", note: "Offers you've received and made, and their threads" },
  { href: "/orders", label: "Orders", note: "Purchases and sales, tracked to delivery" },
];

export type FamilyKey = "marketplace" | "listings" | "offers" | "orders";

export const FAMILY_KEYS: FamilyKey[] = ["marketplace", "listings", "offers", "orders"];

/** Family member for a top-level href, for nav surfaces that walk the register. */
export const FAMILY_HREFS: Record<string, FamilyKey> = {
  "/marketplace": "marketplace",
  "/listings": "listings",
  "/offers": "offers",
  "/orders": "orders",
};

/**
 * Whether a pathname belongs to one family member. `/listings` (the seller's
 * register) and `/listings/<id>` (a public part sheet) share a prefix but are
 * different surfaces, so they're separated explicitly rather than by
 * `startsWith`: a part sheet is where an offer starts, so it reads as
 * Marketplace, while the seller's edit view reads as Listings.
 */
export function matchesFamily(pathname: string, key: FamilyKey): boolean {
  switch (key) {
    case "listings":
      return pathname === "/listings" || /^\/listings\/[^/]+\/edit$/.test(pathname);
    case "marketplace":
      return (
        pathname === "/marketplace" ||
        pathname.startsWith("/marketplace/") ||
        /^\/listings\/[^/]+$/.test(pathname)
      );
    default: {
      const base = `/${key}`;
      return pathname === base || pathname.startsWith(`${base}/`);
    }
  }
}

/** True when `pathname` sits anywhere inside the Marketplace family. */
export function isMarketplaceFamily(pathname: string): boolean {
  return FAMILY_KEYS.some((key) => matchesFamily(pathname, key));
}

/**
 * A rail/index entry. `group` rows are section headings for the routes that
 * follow them — never links, so a child is always one interaction away.
 */
export type NavEntry =
  | ({ kind: "route" } & NavRoute & { child?: boolean })
  | { kind: "group"; label: string; short: string; note: string };

/** Signed-in register, in rail/index order. */
export const PRIMARY_NAV: NavEntry[] = [
  { kind: "route", href: "/home", label: "Home", note: "What's moved since you looked" },
  { kind: "route", href: "/explore", label: "Explore", note: "Builds from the community" },
  {
    kind: "group",
    label: "Marketplace",
    short: "MKT",
    note: "Buying and selling, end to end",
  },
  ...MARKETPLACE_FAMILY.map((route) => ({ kind: "route" as const, ...route, child: true })),
  { kind: "route", href: "/garage", label: "Garage", note: "Your cars and their builds" },
  { kind: "route", href: "/messages", label: "Messages", note: "Every order and offer thread, in one list" },
  { kind: "route", href: "/profile", label: "Profile", note: "How buyers and sellers see you" },
  { kind: "route", href: "/settings", label: "Settings", note: "Account, notifications and payments" },
];

/**
 * Flat register — kept because the docs site and older call sites describe
 * navigation as a single ordered list of routes.
 */
export const BAR_ROUTES: NavRoute[] = PRIMARY_NAV.filter(
  (entry): entry is Extract<NavEntry, { kind: "route" }> => entry.kind === "route"
);

/**
 * Signed-out visitors get the public surfaces only. Listings, Offers and
 * Orders are account management, not pages with a signed-out reading, so they
 * are never advertised here.
 */
export const PUBLIC_ROUTES: NavRoute[] = [
  { href: "/explore", label: "Explore", note: "Builds from the community" },
  { href: "/marketplace", label: "Marketplace", note: "Used parts off modified cars" },
];
