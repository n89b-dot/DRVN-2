"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cx } from "@/lib/format";
import { Icon, type IconName } from "./icons";

type BarRoute = { href: string; label: string; note: string; icon: IconName };

// The register. Text links sit in the desktop bar; every entry appears in the
// index (the compact menu) with its mark and its note.
export const BAR_ROUTES: BarRoute[] = [
  { href: "/home", label: "Sheet", note: "What your sheet saw today", icon: "home" },
  { href: "/explore", label: "Explore", note: "Other people's sheets", icon: "compass" },
  { href: "/marketplace", label: "Market", note: "Parts off live sheets", icon: "market" },
  { href: "/garage", label: "Garage", note: "Your side of the drawing", icon: "garage" },
  { href: "/orders", label: "Orders", note: "Work orders, offers and payouts", icon: "sell" },
  { href: "/profile", label: "Profile", note: "Your keeper sheet", icon: "user" },
];

const UTILITY_ROUTES: BarRoute[] = [
  { href: "/notifications", label: "Notifications", note: "What the bell knows", icon: "bell" },
  { href: "/saved", label: "Saved", note: "Everything you're watching", icon: "bookmark" },
  { href: "/settings", label: "Settings", note: "Your sheet, configured", icon: "settings" },
];

function useTheme(initialNight: boolean) {
  const [night, setNight] = useState(initialNight);

  const toggle = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "day" : "night";
    if (next === "night") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
    document.cookie = `ls-theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
    setNight(next === "night");
  };

  return { night, toggle };
}

function ThemeToggle({
  night,
  toggle,
  className = "bar__theme",
}: {
  night: boolean;
  toggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={toggle}
      aria-pressed={night}
      title="Switch sheet lighting"
    >
      <span className="sw" aria-hidden="true" />
      Sheet <b>{night ? "Night" : "Day"}</b>
    </button>
  );
}

export function LivesheetBar({ initialNight = false }: { initialNight?: boolean }) {
  const pathname = usePathname();
  const { night, toggle } = useTheme(initialNight);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

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
    // Move focus into the sheet so the keyboard follows the eye.
    panelRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const allRoutes = [...BAR_ROUTES, ...UTILITY_ROUTES];

  return (
    <>
      <header className="bar">
        <div className="bar__inner">
          <Link className="bar__logo" href="/home" aria-label="DRVN home">
            DRVN<em>.</em> <span className="microlabel">Livesheet</span>
          </Link>
          <nav className="bar__nav" aria-label="Primary">
            {BAR_ROUTES.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                className={cx("bar__link", isActive(route.href) && "is-active")}
                aria-current={isActive(route.href) ? "page" : undefined}
              >
                {route.label}
              </Link>
            ))}
            {UTILITY_ROUTES.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                className={cx("bar__link", isActive(route.href) && "is-active")}
                aria-label={route.label}
                title={route.label}
              >
                <Icon name={route.icon} className="h-[17px] w-[17px]" />
              </Link>
            ))}
            <ThemeToggle night={night} toggle={toggle} />
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
            {open ? "Close" : "Index"}
          </button>
        </div>
      </header>

      {/* THE INDEX — a second sheet unrolled over the page */}
      <div className={cx("indexwrap", open && "is-open")} id="sheet-index" aria-hidden={!open}>
        <div className="indexsheet" ref={panelRef}>
          <div className="wrap">
            <div className="index__head">
              <span className="microlabel">The index</span>
              <span className="microlabel">{allRoutes.length} registers</span>
            </div>
            <div className="dimline-h" aria-hidden="true" />

            <nav className="index__rows" aria-label="All sections">
              {allRoutes.map((route, i) => {
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
                    <span className="indexrow__ico" aria-hidden="true">
                      <Icon name={route.icon} className="h-[19px] w-[19px]" />
                    </span>
                    <span className="indexrow__label">{route.label}</span>
                    <span className="indexrow__note">{route.note}</span>
                    {here && <span className="indexrow__end chip chip--live">Here</span>}
                  </Link>
                );
              })}
            </nav>

            <div className="index__foot">
              <ThemeToggle night={night} toggle={toggle} />
              <Link
                href="/sell"
                className="btn btn--live"
                tabIndex={open ? undefined : -1}
              >
                List a part
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
