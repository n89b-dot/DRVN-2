"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { cx } from "@/lib/format";
import { Icon } from "./icons";
import { LivesheetBar } from "./livesheet-bar";
import { FAMILY_HREFS, isMarketplaceFamily, matchesFamily, PRIMARY_NAV } from "./nav-routes";

/**
 * The register rail — the drawing's left margin. Signed-in desktop only;
 * below 1081px the index (in the bar) carries navigation instead.
 * Collapsed it keeps the register numbers, which is how a drawing indexes
 * itself when there's no room for words.
 *
 * Marketplace is a *section heading*, not a link and not a disclosure: its
 * four children (Marketplace, Listings, Offers, Orders) sit indented beneath
 * it and each is one click from anywhere, so nobody has to pass through
 * Marketplace to reach Orders.
 */
function AppRail({
  open,
  onToggle,
  offersCount = 0,
}: {
  open: boolean;
  onToggle: () => void;
  /** Offers waiting on this user — shown next to the Offers row so the rail
   *  keeps saying what the old inline /orders microlabel used to. */
  offersCount?: number;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => {
    // Family members overlap on prefix (/listings vs /listings/<id>), so they
    // resolve through the family matcher rather than a bare startsWith.
    const familyKey = FAMILY_HREFS[href];
    if (familyKey) return matchesFamily(pathname, familyKey);
    return pathname === href || pathname.startsWith(`${href}/`);
  };
  const familyHere = isMarketplaceFamily(pathname);

  // Register numbers run continuously down the rail, headings included — the
  // heading is part of the index, not a caption floating beside it.
  let register = 0;

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
        {PRIMARY_NAV.map((entry) => {
          const n = String(++register).padStart(2, "0");

          if (entry.kind === "group") {
            return (
              <p
                key={`group-${entry.label}`}
                className={cx("railgroup", familyHere && "is-family")}
                title={open ? undefined : entry.label}
              >
                <span className="railrow__n">{n}</span>
                <span className="railgroup__label">{entry.label}</span>
                {/* Collapsed, the rail is numbers only — this keeps the family
                    legible instead of leaving four unexplained digits. */}
                <span className="railgroup__mark" aria-hidden="true">
                  {entry.short}
                </span>
              </p>
            );
          }

          const here = isActive(entry.href);
          const badge = entry.href === "/offers" ? offersCount : 0;
          return (
            <Link
              key={entry.href}
              href={entry.href}
              className={cx("railrow", entry.child && "railrow--child", here && "is-here")}
              aria-current={here ? "page" : undefined}
              title={open ? undefined : badge > 0 ? `${entry.label} (${badge})` : entry.label}
              aria-label={badge > 0 ? `${entry.label}, ${badge} needing your attention` : undefined}
            >
              <span className="railrow__n">{n}</span>
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
  cartCount = 0,
  unreadCount = 0,
  offersCount = 0,
  children,
}: {
  signedIn: boolean;
  initialNight: boolean;
  initialRailOpen: boolean;
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
      {signedIn && <AppRail open={railOpen} onToggle={toggleRail} offersCount={offersCount} />}
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
