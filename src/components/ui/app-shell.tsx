"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { cx } from "@/lib/format";
import { Icon } from "./icons";
import { LivesheetBar } from "./livesheet-bar";
import {
  FAMILY_HREFS,
  isSellingFamily,
  matchesFamily,
  PRIMARY_NAV,
  type NavEntry,
} from "./nav-routes";

/**
 * The register rail — the drawing's left margin. Signed-in desktop only;
 * below 1081px the index (in the bar) carries navigation instead. Collapsed
 * it keeps the stroke icons, which is how the margin indexes itself when
 * there's no room for words.
 *
 * Marketplace is a collapsible *section*: the parent row is a real link to
 * /marketplace, styled like every other top-level page, with a disclosure
 * beside it for the three management children (Listings, Offers, Orders).
 * Open by default and remembered per browser, so the disclosure is a way to
 * quiet the rail — never a gate a child hides behind: /listings, /offers and
 * /orders stay one click away via the family subnav on every family surface,
 * and reopening is one tap here.
 */
function AppRail({
  open,
  onToggle,
  initialMktOpen = true,
  offersCount = 0,
}: {
  open: boolean;
  onToggle: () => void;
  /** Whether the Marketplace section starts expanded (cookie-backed). */
  initialMktOpen?: boolean;
  /** Offers waiting on this user — shown next to the Offers row so the rail
   *  keeps saying what the old inline /orders microlabel used to. */
  offersCount?: number;
}) {
  const [mktOpen, setMktOpen] = useState(initialMktOpen);
  const toggleMkt = () => {
    const next = !mktOpen;
    setMktOpen(next);
    document.cookie = `ls-mkt=${next ? "open" : "closed"}; path=/; max-age=31536000; SameSite=Lax`;
  };
  const pathname = usePathname();
  const isActive = (href: string) => {
    // Family members overlap on prefix (/listings vs /listings/<id>), so they
    // resolve through the family matcher rather than a bare startsWith.
    const familyKey = FAMILY_HREFS[href];
    if (familyKey) return matchesFamily(pathname, familyKey);
    return pathname === href || pathname.startsWith(`${href}/`);
  };
  const familyHere = isSellingFamily(pathname);

  return (
    <aside className="rail" aria-label="Sections">
      <div className="rail__head">
        <Link href="/home" className="rail__logo" aria-label="DRVN home">
          <span className="rail__logo-full">
            DRVN<em>.</em>
          </span>
          <span className="rail__logo-mark" aria-hidden="true">
            D<em>.</em>
          </span>
        </Link>
        <button
          type="button"
          className="railtoggle"
          onClick={onToggle}
          aria-pressed={!open}
          aria-label={open ? "Collapse the rail" : "Expand the rail"}
          title={open ? "Collapse the rail" : "Expand the rail"}
        >
          <Icon name="rail" className="h-[17px] w-[17px]" />
        </button>
      </div>

      <nav className="rail__rows">
        {/* Stroke icons carry the margin (they survive the collapsed rail,
            which bare register numbers never did); the label carries the row;
            weight belongs to the row you're on, not to every row at once. */}
        {PRIMARY_NAV.map((entry) => {
          // The group caption and its /marketplace child fold into one parent
          // row — a real link at top-level weight, with the disclosure toggle
          // beside it and the three management children in one container.
          if (entry.kind === "group") {
            const parentHere = matchesFamily(pathname, "selling");
            // Folding the section must not hide attention: the Offers count
            // rides on the parent while the children are away.
            const held = !mktOpen ? offersCount : 0;
            const kids = PRIMARY_NAV.filter(
              (e): e is Extract<NavEntry, { kind: "route" }> =>
                e.kind === "route" && Boolean(e.child) && e.href !== "/selling"
            );
            return (
              <div key="family-selling" className="railfamily">
                <div className="railfam">
                  <Link
                    href="/selling"
                    className={cx(
                      "railrow railfam__link",
                      parentHere && "is-here",
                      !mktOpen && familyHere && !parentHere && "is-holding"
                    )}
                    aria-current={parentHere ? "page" : undefined}
                    title={open ? undefined : "Selling"}
                  >
                    <span className="railrow__ico" aria-hidden="true">
                      <Icon name="sell" className="h-[17px] w-[17px]" />
                      {held > 0 && <span className="railrow__dot" />}
                    </span>
                    <span className="railrow__label flex items-center justify-between gap-2">
                      Selling
                      {held > 0 && (
                        <span className="chip chip--live shrink-0" aria-hidden="true">
                          {held > 9 ? "9+" : held}
                        </span>
                      )}
                    </span>
                  </Link>
                  <button
                    type="button"
                    className={cx("railfam__toggle", mktOpen && "is-open")}
                    onClick={toggleMkt}
                    aria-expanded={mktOpen}
                    aria-controls="rail-selling-kids"
                    aria-label={
                      mktOpen
                        ? "Collapse the Selling section"
                        : "Expand the Selling section"
                    }
                  >
                    <Icon name="back" className="h-[13px] w-[13px]" />
                  </button>
                </div>

                {/* Folded children stay mounted: the 68px icon rail has no
                    labels to declutter, so it always shows the whole family
                    (CSS overrides the fold below 1081px/collapsed). */}
                <div
                  id="rail-selling-kids"
                  className={cx("railkids", !mktOpen && "is-folded")}
                >
                  <div className="railkids__in">
                  {kids.map((kid) => {
                    const here = isActive(kid.href);
                    const badge = kid.href === "/offers" ? offersCount : 0;
                    return (
                      <Link
                        key={kid.href}
                        href={kid.href}
                        className={cx("railrow railrow--child", here && "is-here")}
                        aria-current={here ? "page" : undefined}
                        title={
                          open ? undefined : badge > 0 ? `${kid.label} (${badge})` : kid.label
                        }
                        aria-label={
                          badge > 0 ? `${kid.label}, ${badge} needing your attention` : undefined
                        }
                        tabIndex={mktOpen ? undefined : -1}
                      >
                        <span className="railrow__ico" aria-hidden="true">
                          <Icon name={kid.icon} className="h-[17px] w-[17px]" />
                          {badge > 0 && <span className="railrow__dot" />}
                        </span>
                        <span className="railrow__label flex items-center justify-between gap-2">
                          {kid.label}
                          {badge > 0 && (
                            <span className="chip chip--live shrink-0" aria-hidden="true">
                              {badge > 9 ? "9+" : badge}
                            </span>
                          )}
                        </span>
                      </Link>
                    );
                  })}
                  </div>
                </div>
              </div>
            );
          }

          // Family children render inside the disclosure above.
          if (entry.child) return null;

          const here = isActive(entry.href);
          return (
            <Link
              key={entry.href}
              href={entry.href}
              className={cx("railrow", here && "is-here")}
              aria-current={here ? "page" : undefined}
              title={open ? undefined : entry.label}
            >
              <span className="railrow__ico" aria-hidden="true">
                <Icon name={entry.icon} className="h-[17px] w-[17px]" />
              </span>
              <span className="railrow__label flex items-center justify-between gap-2">
                {entry.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="rail__foot">
        <Link href="/sell" className="btn btn--live rail__cta" title="List a part">
          <span className="rail__cta-full">List a part</span>
          <span className="rail__cta-mark" aria-hidden="true">
            +
          </span>
        </Link>
      </div>
    </aside>
  );
}

export function AppShell({
  signedIn,
  initialNight,
  initialRailOpen,
  initialMktOpen = true,
  cartCount = 0,
  unreadCount = 0,
  offersCount = 0,
  children,
}: {
  signedIn: boolean;
  initialNight: boolean;
  initialRailOpen: boolean;
  /** Whether the rail's Marketplace section starts expanded (cookie-backed). */
  initialMktOpen?: boolean;
  cartCount?: number;
  unreadCount?: number;
  /** Offers waiting on this user — badges the Offers row in the rail and index. */
  offersCount?: number;
  children: ReactNode;
}) {
  const [railOpen, setRailOpen] = useState(initialRailOpen);

  const toggleRail = () => {
    const next = !railOpen;
    setRailOpen(next);
    document.cookie = `ls-rail=${next ? "open" : "closed"}; path=/; max-age=31536000; SameSite=Lax`;
  };

  return (
    <div
      className="shell"
      data-signed-in={signedIn ? "true" : "false"}
      data-rail={railOpen ? "open" : "closed"}
    >
      {/* First tab stop: keyboard users skip the rail and bar entirely. */}
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {signedIn && (
        <AppRail
          open={railOpen}
          onToggle={toggleRail}
          initialMktOpen={initialMktOpen}
          offersCount={offersCount}
        />
      )}
      <div className="shell__body">
        <LivesheetBar
          initialNight={initialNight}
          signedIn={signedIn}
          cartCount={cartCount}
          unreadCount={unreadCount}
          offersCount={offersCount}
        />
        <main id="main" className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
