"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { cx } from "@/lib/format";
import { Icon } from "./icons";
import { BAR_ROUTES, LivesheetBar } from "./livesheet-bar";

/**
 * The register rail — the drawing's left margin. Signed-in desktop only;
 * below 1081px the index (in the bar) carries navigation instead.
 * Collapsed it keeps the register numbers, which is how a drawing indexes
 * itself when there's no room for words.
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
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

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
        {BAR_ROUTES.map((route, i) => {
          const here = isActive(route.href);
          const badge = route.href === "/offers" ? offersCount : 0;
          return (
            <Link
              key={route.href}
              href={route.href}
              className={cx("railrow", here && "is-here")}
              aria-current={here ? "page" : undefined}
              title={open ? undefined : badge > 0 ? `${route.label} (${badge})` : route.label}
            >
              <span className="railrow__n">{String(i + 1).padStart(2, "0")}</span>
              <span className="railrow__label flex items-center justify-between gap-2">
                {route.label}
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
