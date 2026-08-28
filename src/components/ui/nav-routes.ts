/**
 * The register — one description of DRVN's navigation, read by the desktop
 * rail, the mobile index and the Selling family subnav.
 *
 * The IA (brief §J, decision recorded in /docs/implementation): Marketplace
 * is where people discover and buy — one top-level surface. Selling is where
 * sellers operate — a family of five (Overview → what I'm selling → what's
 * being negotiated → what actually sold → where the money stands). Orders
 * carries purchases too; it lives with Selling because that's where its
 * operational weight is, while buyers keep reaching their orders from Home,
 * notifications and receipts. The family is a grouping in the navigation,
 * not a tab component.
 */

import type { IconName } from "./icons";

export type NavRoute = { href: string; label: string; note: string; icon: IconName };

/** The Selling family, in operating order. Index 0 is the family's home. */
export const SELLING_FAMILY: NavRoute[] = [
  { href: "/selling", label: "Selling", note: "Your shop at a glance — what needs you first", icon: "sell" },
  // "My Listings", not "Listings": the register sits beside a public
  // Marketplace full of listings, and the possessive is what tells a seller
  // this is *their* stock. The route stays /listings.
  { href: "/listings", label: "My Listings", note: "Views, watchers and offers on what you're selling", icon: "box" },
  { href: "/offers", label: "Offers", note: "Offers you've received and made, and their threads", icon: "scale" },
  { href: "/orders", label: "Orders", note: "Purchases and sales, tracked to delivery", icon: "gauge" },
  { href: "/payouts", label: "Payouts", note: "What you've earned and where it stands", icon: "card" },
];

export type FamilyKey = "selling" | "marketplace" | "listings" | "offers" | "orders" | "payouts";

export const FAMILY_KEYS: FamilyKey[] = [
  "selling",
  "marketplace",
  "listings",
  "offers",
  "orders",
  "payouts",
];

/** Family member for a top-level href, for nav surfaces that walk the register. */
export const FAMILY_HREFS: Record<string, FamilyKey> = {
  "/selling": "selling",
  "/marketplace": "marketplace",
  "/listings": "listings",
  "/offers": "offers",
  "/orders": "orders",
  "/payouts": "payouts",
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

/** True when `pathname` sits anywhere inside the Selling family. */
export function isSellingFamily(pathname: string): boolean {
  return SELLING_FAMILY.some((route) => matchesFamily(pathname, FAMILY_HREFS[route.href]));
}

/** True when `pathname` is a marketplace (discovery) surface. */
export function isMarketplaceFamily(pathname: string): boolean {
  return matchesFamily(pathname, "marketplace");
}

/**
 * A rail/index entry. `group` rows are section headings for the routes that
 * follow them — never links, so a child is always one interaction away.
 */
export type NavEntry =
  | ({ kind: "route" } & NavRoute & { child?: boolean })
  | { kind: "group"; label: string; note: string };

/** Signed-in register, in rail/index order. */
export const PRIMARY_NAV: NavEntry[] = [
  { kind: "route", href: "/home", label: "Home", note: "What's moved since you looked", icon: "home" },
  { kind: "route", href: "/explore", label: "Explore", note: "Builds from the community", icon: "compass" },
  { kind: "route", href: "/marketplace", label: "Marketplace", note: "Used parts off modified cars", icon: "market" },
  {
    kind: "group",
    label: "Selling",
    note: "Your shop: stock, offers, orders, payouts",
  },
  ...SELLING_FAMILY.map((route) => ({ kind: "route" as const, ...route, child: true })),
  { kind: "route", href: "/garage", label: "Garage", note: "Your cars and their builds", icon: "garage" },
  { kind: "route", href: "/messages", label: "Messages", note: "Every order and offer thread, in one list", icon: "comment" },
  { kind: "route", href: "/profile", label: "Profile", note: "How buyers and sellers see you", icon: "user" },
  { kind: "route", href: "/settings", label: "Settings", note: "Account, notifications and payments", icon: "settings" },
];

/**
 * Flat register — kept because the docs site and older call sites describe
 * navigation as a single ordered list of routes.
 */
export const BAR_ROUTES: NavRoute[] = PRIMARY_NAV.filter(
  (entry): entry is Extract<NavEntry, { kind: "route" }> => entry.kind === "route"
);

/**
 * Signed-out visitors get the public surfaces only. Selling surfaces are
 * account management, not pages with a signed-out reading, so they are never
 * advertised here.
 */
export const PUBLIC_ROUTES: NavRoute[] = [
  { href: "/explore", label: "Explore", note: "Builds from the community", icon: "compass" },
  { href: "/marketplace", label: "Marketplace", note: "Used parts off modified cars", icon: "market" },
];
