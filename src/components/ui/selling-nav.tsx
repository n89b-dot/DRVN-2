import Link from "next/link";

import { cx } from "@/lib/format";

import { FAMILY_HREFS, SELLING_FAMILY, type FamilyKey } from "./nav-routes";
import { ScrollActiveIntoView } from "./scroll-active";

/**
 * The Selling family's local register — Selling | My Listings | Offers |
 * Orders | Payouts, one interaction apart from anywhere a seller operates
 * (brief §J). Marketplace surfaces no longer carry this strip: discovery
 * pages are for buying, and their local navigation is categories and filters.
 *
 * One contained plate (`.familynav` in globals.css): a recessed bar with the
 * sheet you're reading raised onto the tile surface under the live tick.
 * It is the family's navigation where the rail isn't — at desktop widths the
 * rail lists the same five members and the plate stands down (CSS), and on
 * phones it scrolls with the page rather than pinning under the bar.
 * Server-rendered — the active member is passed in rather than read from the
 * pathname, so a detail route can name its own family member (an offer thread
 * is Offers) without shipping a client bundle to do it.
 *
 * Signed-out visitors never see this: everything here is account management.
 */
export function SellingNav({
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
    <nav className={cx("familynav", className)} aria-label="Selling sections">
      <div className="familynav__rows">
        {SELLING_FAMILY.map((route) => {
          const key = FAMILY_HREFS[route.href];
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
