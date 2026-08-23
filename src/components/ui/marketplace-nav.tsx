import Link from "next/link";

import { cx } from "@/lib/format";

import { MARKETPLACE_FAMILY, type FamilyKey } from "./nav-routes";
import { ScrollActiveIntoView } from "./scroll-active";

const KEY_FOR_HREF: Record<string, FamilyKey> = {
  "/marketplace": "marketplace",
  "/listings": "listings",
  "/offers": "offers",
  "/orders": "orders",
};

/**
 * The Marketplace family's local register — Marketplace | My Listings |
 * Offers | Orders, one interaction apart from anywhere inside the family.
 *
 * One contained plate (see `.familynav` in globals.css): a recessed bar with
 * the sheet you're reading raised onto the tile surface under the live tick.
 * Contiguous rather than chips, so it reads as local navigation — a level
 * under the global bar, and never mistaken for the filter rows below it.
 * Marketplace = browse/buy · My Listings = what I'm selling · Offers =
 * negotiations · Orders = purchases and sales.
 * Server-rendered — the active member is passed in rather than read from the
 * pathname, so a detail route can name its own family member (an offer thread
 * is Offers) without shipping a client bundle to do it.
 *
 * Signed-out visitors never see this: My Listings, Offers and Orders are account
 * management, so pages render it only when there's a user.
 */
export function MarketplaceNav({
  current,
  offersCount = 0,
  className = "",
}: {
  current: FamilyKey;
  /** Offers genuinely waiting on this user — the same count the rail badges. */
  offersCount?: number;
  className?: string;
}) {
  return (
    // No visible section caption: the first item *is* "Marketplace", and a
    // label above it read as a stutter ("Marketplace — Marketplace My Listings
    // Offers Orders"). The accessible name carries the same information for
    // anyone who can't see the strip.
    <nav className={cx("familynav", className)} aria-label="Marketplace sections">
      <div className="familynav__rows">
        {MARKETPLACE_FAMILY.map((route) => {
          const key = KEY_FOR_HREF[route.href];
          const here = key === current;
          const badge = key === "offers" ? offersCount : 0;
          return (
            <Link
              key={route.href}
              href={route.href}
              className={cx("familynav__item", here && "is-here")}
              aria-current={here ? "page" : undefined}
            >
              {route.label}
              {badge > 0 && (
                <span className="familynav__n" aria-label={`${badge} needing your attention`}>
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </Link>
          );
        })}
        <ScrollActiveIntoView selector=".is-here" />
      </div>
    </nav>
  );
}
