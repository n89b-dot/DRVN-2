"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const noopSubscribe = () => () => {};

import { Icon, type IconName } from "@/components/ui/icons";
import type { NavCounts } from "@/lib/admin/queries";
import { cx } from "@/lib/format";

type ConsoleRoute = { href: string; label: string; note: string; icon: IconName };

const LINKS: ConsoleRoute[] = [
  { href: "/admin", label: "Overview", note: "Queues and the last seven days", icon: "gauge" },
  { href: "/admin/cases", label: "Cases", note: "Claimable work: disputes & reports", icon: "book" },
  { href: "/admin/disputes", label: "Disputes", note: "Open cases, oldest first", icon: "scale" },
  { href: "/admin/orders", label: "Orders", note: "Search, inspect, intervene", icon: "box" },
  { href: "/admin/listings", label: "Listings", note: "Moderate the stock", icon: "sell" },
  { href: "/admin/users", label: "Users", note: "Suspend, restore, inspect", icon: "user" },
  { href: "/admin/invitations", label: "Invitations", note: "Control beta membership", icon: "user" },
  { href: "/admin/reports", label: "Reports", note: "User-flagged listings & sellers", icon: "flag" },
  { href: "/admin/payments", label: "Payments", note: "Recoveries and stuck transfers", icon: "card" },
  { href: "/admin/agent", label: "Agent", note: "Kill switches and health", icon: "gauge" },
  { href: "/admin/products", label: "Products", note: "Part identity the graph couldn't decide", icon: "box" },
  { href: "/admin/audit", label: "Audit", note: "The append-only record", icon: "book" },
  { href: "/admin/settings", label: "Settings", note: "Theme, alerts, and who holds a key", icon: "settings" },
];

/**
 * Section nav with live queue badges — the backlog visible from anywhere in
 * the console (the Reddit-mod-queue idiom, in SheetTabs' `.n n--live`
 * count style). A badge is only ever the number of things waiting on a
 * human, so a silent nav genuinely means a clear queue.
 *
 * Two renderings of the same register: a pill row wide, and on phones the
 * product app's index — the bar button that unrolls a sheet of numbered
 * rows (LivesheetBar's idiom, reusing its `.indexbtn`/`.indexrow` CSS
 * wholesale) with a section icon on every row.
 */
export function AdminNav({
  counts,
  initialNight = false,
}: {
  counts: NavCounts;
  initialNight?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Theme plumbing mirrored from LivesheetBar: the root layout's inline
  // script stamps data-theme from the cookie before first paint, so the DOM
  // is the truth — useSyncExternalStore reads it after hydration (server
  // snapshot = the cookie the layout passed in), and toggling rewrites both
  // the DOM and the cookie the product shell shares.
  const themeListeners = useRef(new Set<() => void>());
  const subscribeTheme = useCallback((cb: () => void) => {
    const listeners = themeListeners.current;
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, []);
  const night = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.dataset.theme === "dark",
    () => initialNight,
  );
  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "day" : "night";
    if (next === "night") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
    document.cookie = `ls-theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
    themeListeners.current.forEach((cb) => cb());
  };
  // The sheet portals to <body>: rendered in place it would be a child of the
  // sticky header and paint over the very bar (brand + Close) that controls
  // it. Portal only after hydration — there's no document during SSR
  // (useSyncExternalStore is the effect-free hydration probe: server snapshot
  // false, client snapshot true).
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const panelRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
  const badgeFor: Record<string, number | null> = {
    "/admin/disputes": counts.disputes,
    "/admin/reports": counts.reports,
    "/admin/payments": counts.money,
    "/admin/products": counts.products,
  };

  // Close the index on navigation — the page you asked for is now underneath
  // it. Adjusted during render (React's reset-on-change pattern), same as
  // LivesheetBar.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  // Escape closes; the queue behind must not scroll while the index is over it.
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

  return (
    <>
      {/* One flex group so the header's justify-between keeps brand left and
          this whole control cluster right. */}
      <div className="flex items-center gap-2">
      <nav aria-label="Console sections" className="filters console-nav !mb-0">
        {LINKS.map(({ href, label, icon }) => {
          const active = isActive(href);
          const badge = href in badgeFor ? badgeFor[href] : 0;
          return (
            <Link
              key={href}
              href={href}
              className={cx("fbtn", active && "is-on")}
              aria-current={active ? "page" : undefined}
            >
              <Icon name={icon} className="h-[14px] w-[14px]" />
              {label}
              {badge === null ? (
                <span className="n n--live" aria-label="Count unavailable" title="Count unavailable">
                  ?
                </span>
              ) : badge > 0 ? (
                <span className="n n--live" aria-label={`${badge} waiting`}>
                  {badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        className="bar__link bar__link--ico"
        onClick={toggleTheme}
        aria-pressed={night}
        aria-label={night ? "Switch to light theme" : "Switch to dark theme"}
        title={night ? "Dark theme" : "Light theme"}
      >
        <Icon name={night ? "moon" : "sun"} className="h-[17px] w-[17px]" />
      </button>

      <button
        type="button"
        className={cx("indexbtn console-indexbtn", open && "is-open")}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="console-index"
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

      {/* THE INDEX — the console's sections as a sheet unrolled over the queue */}
      {mounted &&
        createPortal(
          <div className={cx("indexwrap", open && "is-open")} id="console-index" aria-hidden={!open}>
        <div className="indexsheet" ref={panelRef}>
          <div className="wrap">
            <div className="index__head">
              <span className="microlabel">Console</span>
              <span className="microlabel">{LINKS.length} sections</span>
            </div>
            <div className="dimline-h" aria-hidden="true" />

            <nav className="index__rows" aria-label="All console sections">
              {LINKS.map(({ href, label, note, icon }, i) => {
                const here = isActive(href);
                const badge = href in badgeFor ? badgeFor[href] : 0;
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cx("indexrow", here && "is-here")}
                    style={{ ["--i" as string]: i }}
                    aria-current={here ? "page" : undefined}
                    tabIndex={open ? undefined : -1}
                  >
                    <span className="indexrow__n">{String(i + 1).padStart(2, "0")}</span>
                    <span className="indexrow__label">
                      <Icon name={icon} className="indexrow__ico" />
                      {label}
                    </span>
                    <span className="indexrow__note">{note}</span>
                    {here ? (
                      <span className="indexrow__end chip chip--live">Here</span>
                    ) : badge === null ? (
                      <span className="indexrow__end chip chip--live" aria-label="Count unavailable">
                        Unavailable
                      </span>
                    ) : badge > 0 ? (
                      <span
                        className="indexrow__end chip chip--live"
                        aria-label={`${badge} waiting`}
                      >
                        {badge}
                      </span>
                    ) : null}
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
                Theme <b>{night ? "Dark" : "Light"}</b>
              </button>
            </div>
          </div>
        </div>
          </div>,
          document.body,
        )}
    </>
  );
}
