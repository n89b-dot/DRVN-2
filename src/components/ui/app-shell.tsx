"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { StreamedShellCounts, type ShellCounts } from "./streamed-shell-counts";

import { cx } from "@/lib/format";
import { BottomNav } from "./bottom-nav";
import { Icon } from "./icons";
import { LivesheetBar } from "./livesheet-bar";
import {
  BOTTOM_NAV,
  BOTTOM_NAV_PUBLIC,
  bottomNavActive,
  bottomNavHiddenOn,
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
 * Selling is a collapsible *section*: the parent row is a real link to
 * /selling, styled like every other top-level page, with a disclosure beside
 * it for the management children (Listings, Offers, Orders, Payouts).
 * Folded by default and unfolded on the selling routes themselves: most of a
 * member's day is Home, Explore and the garage, where four seller rows were
 * a third of the rail. The disclosure is never a gate a child hides behind —
 * every family surface carries the family subnav, the Offers count rides on
 * the folded parent, and unfolding is one tap here (held until the reader
 * moves between selling and non-selling pages).
 */
function AppRail({
  open,
  onToggle,
  initialMktOpen = true,
  offersCount = 0,
  messagesCount = 0,
}: {
  open: boolean;
  onToggle: () => void;
  /** Deprecated: the Selling section now follows the route (see above). */
  initialMktOpen?: boolean;
  /** Offers waiting on this user — shown next to the Offers row so the rail
   *  keeps saying what the old inline /orders microlabel used to. */
  offersCount?: number;
  /** Conversations with something unread (N-5). A count, not a dot: a buyer
   *  waiting on one answer and a seller with nine threads open are different
   *  situations and the rail can say which. */
  messagesCount?: number;
}) {
  const pathname = usePathname();
  const familyHere = isSellingFamily(pathname);
  // null = follow the route (unfolded on selling pages, folded elsewhere);
  // a tap overrides that until the reader crosses into or out of the family.
  // `initialMktOpen` (the old per-browser cookie) no longer decides it.
  void initialMktOpen;
  const [mktChoice, setMktChoice] = useState<boolean | null>(null);
  const [choiceFamily, setChoiceFamily] = useState(familyHere);
  if (choiceFamily !== familyHere) {
    setChoiceFamily(familyHere);
    setMktChoice(null);
  }
  const mktOpen = mktChoice ?? familyHere;
  const toggleMkt = () => setMktChoice(!mktOpen);
  const isActive = (href: string) => {
    // Family members overlap on prefix (/listings vs /listings/<id>), so they
    // resolve through the family matcher rather than a bare startsWith.
    const familyKey = FAMILY_HREFS[href];
    if (familyKey) return matchesFamily(pathname, familyKey);
    return pathname === href || pathname.startsWith(`${href}/`);
  };

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
          const badge = entry.href === "/messages" ? messagesCount : 0;
          return (
            <Link
              key={entry.href}
              href={entry.href}
              className={cx("railrow", here && "is-here")}
              aria-current={here ? "page" : undefined}
              title={open ? undefined : badge > 0 ? `${entry.label} (${badge})` : entry.label}
              aria-label={
                badge > 0
                  ? `${entry.label}, ${badge} conversation${badge === 1 ? "" : "s"} with unread messages`
                  : undefined
              }
            >
              <span className="railrow__ico" aria-hidden="true">
                <Icon name={entry.icon} className="h-[17px] w-[17px]" />
                {/* The collapsed rail has no room for a count, so it keeps
                    the dot — same information, one bit of it. */}
                {badge > 0 && <span className="railrow__dot" />}
              </span>
              <span className="railrow__label flex items-center justify-between gap-2">
                {entry.label}
                {badge > 0 && (
                  <span className="chip chip--live shrink-0" aria-hidden="true">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="rail__foot">
        {/* Outlined, not red: the top bar's Post is the shell's one filled
            accent, so a page's own primary action has room to lead. */}
        <Link href="/sell" className="btn btn--ghost rail__cta" title="List a part">
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
  messagesCount = 0,
  children,
  counts,
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
  /** Conversations with something unread — badges Messages (N-5). */
  messagesCount?: number;
  children: ReactNode;
  counts?: Promise<ShellCounts>;
}) {
  const [railOpen, setRailOpen] = useState(initialRailOpen);
  const pathname = usePathname();

  const toggleRail = () => {
    const next = !railOpen;
    setRailOpen(next);
    document.cookie = `ls-rail=${next ? "open" : "closed"}; path=/; max-age=31536000; SameSite=Lax`;
  };

  const renderRail = (values: ShellCounts) => (
    <AppRail open={railOpen} onToggle={toggleRail} initialMktOpen={initialMktOpen} offersCount={values.offersCount} messagesCount={values.messagesCount} />
  );
  const renderBar = (values: ShellCounts) => (
    <LivesheetBar initialNight={initialNight} signedIn={signedIn} {...values} />
  );
  const initialCounts = { cartCount, unreadCount, offersCount, messagesCount };

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
        counts ? <Suspense fallback={renderRail(initialCounts)}>
          <StreamedShellCounts counts={counts}>{renderRail}</StreamedShellCounts>
        </Suspense> : renderRail(initialCounts)
      )}
      <div className="shell__body">
        {counts ? <Suspense fallback={renderBar(initialCounts)}>
          <StreamedShellCounts counts={counts}>{renderBar}</StreamedShellCounts>
        </Suspense> : renderBar(initialCounts)}
        <main id="main" className="min-w-0">{children}</main>
      </div>
      <BottomNav
        items={(signedIn ? BOTTOM_NAV : BOTTOM_NAV_PUBLIC).map((route) => ({
          href: route.href,
          label: route.label,
          icon: route.icon,
          active: bottomNavActive(pathname, route.href),
        }))}
        hidden={bottomNavHiddenOn(pathname)}
      />
    </div>
  );
}
