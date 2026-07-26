"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cx } from "@/lib/format";
import { Icon, type IconName } from "./icons";

type BarRoute = { href: string; label: string; note: string };
type IconRoute = BarRoute & { icon: IconName };

// The register. On signed-in desktop these live in the rail; everywhere else
// they live in the index (the compact menu).
export const BAR_ROUTES: BarRoute[] = [
  { href: "/home", label: "Sheet", note: "What your sheet saw today" },
  { href: "/explore", label: "Explore", note: "Other people's sheets" },
  { href: "/marketplace", label: "Market", note: "Parts off live sheets" },
  { href: "/garage", label: "Garage", note: "Your side of the drawing" },
  { href: "/orders", label: "Orders", note: "Work orders, offers and payouts" },
  { href: "/profile", label: "Profile", note: "Your keeper sheet" },
];

// Icon-only in the bar at every width — the furniture that stays to hand.
const UTILITY_ROUTES: IconRoute[] = [
  { href: "/cart", label: "Cart", note: "Lines waiting to be confirmed", icon: "cart" },
  { href: "/notifications", label: "Notifications", note: "What the bell knows", icon: "bell" },
  { href: "/saved", label: "Saved", note: "Everything you're watching", icon: "bookmark" },
  { href: "/settings", label: "Settings", note: "Your sheet, configured", icon: "settings" },
];

// Signed-out visitors get the two public surfaces, not the whole register.
const PUBLIC_ROUTES: BarRoute[] = [
  { href: "/explore", label: "Explore", note: "Other people's sheets" },
  { href: "/marketplace", label: "Market", note: "Parts off live sheets" },
];

/** Sheet lighting — an icon switch, not a labelled control. */
function ThemeToggle({ night, toggle }: { night: boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      className="bar__link bar__link--ico"
      onClick={toggle}
      aria-pressed={night}
      aria-label={night ? "Switch to day sheet" : "Switch to night sheet"}
      title={night ? "Night sheet" : "Day sheet"}
    >
      <Icon name={night ? "moon" : "sun"} className="h-[17px] w-[17px]" />
    </button>
  );
}

export function LivesheetBar({
  initialNight = false,
  signedIn = true,
  cartCount = 0,
  unreadCount = 0,
}: {
  initialNight?: boolean;
  signedIn?: boolean;
  /** Rendered as a badge so a filled cart is visible from anywhere. */
  cartCount?: number;
  unreadCount?: number;
}) {
  const pathname = usePathname();
  const [night, setNight] = useState(initialNight);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "day" : "night";
    if (next === "night") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
    document.cookie = `ls-theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
    setNight(next === "night");
  };

  // Close the index on navigation — the sheet you asked for is now underneath
  // it. Adjusted during render (React's reset-on-change pattern) rather than in
  // an effect, so it never costs an extra paint with the menu still open.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  // Escape closes; the page behind must not scroll while the index is over it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  // The index carries whatever the current surface doesn't already show.
  const indexRoutes: BarRoute[] = signedIn
    ? [...BAR_ROUTES, ...UTILITY_ROUTES]
    : [...PUBLIC_ROUTES, { href: "/login", label: "Sign in", note: "Open a sheet you already keep" }];

  return (
    <>
      <header className="bar">
        <div className="bar__inner">
          <Link className="bar__logo" href={signedIn ? "/home" : "/"} aria-label="DRVN home">
            DRVN<em>.</em> <span className="microlabel">Livesheet</span>
          </Link>

          <nav className="bar__nav" aria-label="Primary">
            {/* Signed-out visitors keep text links; signed-in navigation is the rail. */}
            {!signedIn &&
              PUBLIC_ROUTES.map((route) => (
                <Link
                  key={route.href}
                  href={route.href}
                  className={cx("bar__link", "bar__link--text", isActive(route.href) && "is-active")}
                  aria-current={isActive(route.href) ? "page" : undefined}
                >
                  {route.label}
                </Link>
              ))}

            {signedIn &&
              UTILITY_ROUTES.map((route) => {
                const badge =
                  route.href === "/cart"
                    ? cartCount
                    : route.href === "/notifications"
                      ? unreadCount
                      : 0;
                return (
                  <Link
                    key={route.href}
                    href={route.href}
                    className={cx(
                      "bar__link",
                      "bar__link--ico",
                      // Settings folds into the index on phones — it's a
                      // destination you visit, not furniture you reach for.
                      route.href === "/settings" && "bar__link--roomy",
                      isActive(route.href) && "is-active",
                    )}
                    aria-label={badge > 0 ? `${route.label} (${badge})` : route.label}
                    title={route.label}
                  >
                    <Icon name={route.icon} className="h-[17px] w-[17px]" />
                    {badge > 0 && (
                      <span className="barbadge" aria-hidden="true">
                        {badge > 9 ? "9+" : badge}
                      </span>
                    )}
                  </Link>
                );
              })}

            <ThemeToggle night={night} toggle={toggleTheme} />

            {!signedIn && (
              <>
                <Link
                  href="/login"
                  className={cx("bar__link", "bar__link--text", isActive("/login") && "is-active")}
                >
                  Sign in
                </Link>
                <Link href="/signup" className="btn btn--live bar__cta">
                  Open your sheet
                </Link>
              </>
            )}
          </nav>

          <button
            type="button"
            className={cx("indexbtn", open && "is-open")}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="sheet-index"
            aria-label={open ? "Close the index" : "Open the index"}
          >
            <span className="indexbtn__rules" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="indexbtn__label">{open ? "Close" : "Index"}</span>
          </button>
        </div>
      </header>

      {/* THE INDEX — a second sheet unrolled over the page */}
      <div className={cx("indexwrap", open && "is-open")} id="sheet-index" aria-hidden={!open}>
        <div className="indexsheet" ref={panelRef}>
          <div className="wrap">
            <div className="index__head">
              <span className="microlabel">The index</span>
              <span className="microlabel">{indexRoutes.length} registers</span>
            </div>
            <div className="dimline-h" aria-hidden="true" />

            <nav className="index__rows" aria-label="All sections">
              {indexRoutes.map((route, i) => {
                const here = isActive(route.href);
                return (
                  <Link
                    key={route.href}
                    href={route.href}
                    className={cx("indexrow", here && "is-here")}
                    style={{ ["--i" as string]: i }}
                    aria-current={here ? "page" : undefined}
                    tabIndex={open ? undefined : -1}
                  >
                    <span className="indexrow__n">{String(i + 1).padStart(2, "0")}</span>
                    <span className="indexrow__label">{route.label}</span>
                    <span className="indexrow__note">{route.note}</span>
                    {here && <span className="indexrow__end chip chip--live">Here</span>}
                  </Link>
                );
              })}
            </nav>

            <div className="index__foot">
              <button
                type="button"
                className="indexlight"
                onClick={toggleTheme}
                aria-pressed={night}
                tabIndex={open ? undefined : -1}
              >
                <Icon name={night ? "moon" : "sun"} className="h-[17px] w-[17px]" />
                Sheet <b>{night ? "Night" : "Day"}</b>
              </button>
              <Link href={signedIn ? "/sell" : "/signup"} className="btn btn--live" tabIndex={open ? undefined : -1}>
                {signedIn ? "List a part" : "Open your sheet"}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Livesheet page footer — mono microlabels on a mid rule. */
export function Foot({
  left,
  right,
}: {
  left: string;
  right?: React.ReactNode;
}) {
  return (
    <footer className="foot">
      <span className="microlabel">{left}</span>
      {right ? <span className="microlabel">{right}</span> : null}
    </footer>
  );
}
