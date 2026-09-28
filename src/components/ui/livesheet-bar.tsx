"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { cx } from "@/lib/format";
import { ButtonLink } from "./button";
import { Icon, type IconName } from "./icons";
import {
  BAR_ROUTES,
  FAMILY_HREFS,
  isSellingFamily,
  matchesFamily,
  PRIMARY_NAV,
  PUBLIC_ROUTES,
  type NavEntry,
  type NavRoute,
} from "./nav-routes";
import { SuggestingSearchField } from "./search-suggest";

type IconRoute = NavRoute & { icon: IconName };

/** Re-exported so existing call sites keep importing the register from here. */
export { BAR_ROUTES };

// Icon-only in the bar at every width — the furniture that stays to hand.
const UTILITY_ROUTES: IconRoute[] = [
  { href: "/cart", label: "Cart", note: "Parts waiting for checkout", icon: "cart" },
  { href: "/notifications", label: "Notifications", note: "Offers, sales and activity", icon: "bell" },
  { href: "/saved", label: "Saved", note: "Parts, builds and sellers you follow", icon: "bookmark" },
];

const GUEST_UTILITY_ROUTES = UTILITY_ROUTES.filter((route) => route.href === "/cart");

/** Theme — an icon switch, not a labelled control. */
function ThemeToggle({ night, toggle }: { night: boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      className="bar__link bar__link--ico bar__theme"
      onClick={toggle}
      aria-pressed={night}
      aria-label={night ? "Switch to light theme" : "Switch to dark theme"}
      title={night ? "Dark theme" : "Light theme"}
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
  offersCount = 0,
  messagesCount = 0,
}: {
  initialNight?: boolean;
  signedIn?: boolean;
  /** Rendered as a badge so a filled cart is visible from anywhere. */
  cartCount?: number;
  unreadCount?: number;
  /** Offers waiting on this user — badges the Offers row in the index. */
  offersCount?: number;
  /** Unread conversations — badges the Messages row in the index (N-5). */
  messagesCount?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const indexBtnRef = useRef<HTMLButtonElement>(null);
  const FOCUSABLE_SEL =
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

  // The root layout's inline script (src/app/layout.tsx) stamps data-theme on
  // <html> from the cookie before first paint, independently of whatever
  // `initialNight` this layout passed in (some layouts, like (legal), pass
  // none at all so they can stay static). useSyncExternalStore reads the DOM
  // truth after hydration (server snapshot = initialNight during SSR), and
  // `bumpTheme` re-notifies subscribers when the toggle rewrites the DOM.
  const themeListeners = useRef(new Set<() => void>());
  const subscribeTheme = useCallback((cb: () => void) => {
    const listeners = themeListeners.current;
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, []);
  const night = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.dataset.theme === "dark",
    () => initialNight
  );
  const bumpTheme = () => themeListeners.current.forEach((cb) => cb());

  const isActive = (href: string) => {
    // Family members overlap on prefix (/listings vs /listings/<id>), so they
    // resolve through the family matcher rather than a bare startsWith.
    const familyKey = FAMILY_HREFS[href];
    if (familyKey) return matchesFamily(pathname, familyKey);
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "day" : "night";
    if (next === "night") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
    document.cookie = `ls-theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
    bumpTheme();
  };

  // Close the index on navigation — the sheet you asked for is now underneath
  // it. Adjusted during render (React's reset-on-change pattern) rather than in
  // an effect, so it never costs an extra paint with the menu still open.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  // Escape closes; the page behind must not scroll while the index is over
  // it; Tab is trapped inside the panel so it doesn't leak focus to the inert
  // page underneath; closing restores focus to the button that opened it.
  useEffect(() => {
    if (!open) return;

    const restoreTo = indexBtnRef.current;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SEL)
      ).filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      restoreTo?.focus();
    };
  }, [open]);

  // The index carries whatever the current surface doesn't already show. The
  // Marketplace family appears as a heading with its four children directly
  // beneath — Index → Orders is one tap, never Index → Marketplace → Orders.
  const indexEntries: NavEntry[] = signedIn
    ? [...PRIMARY_NAV, ...UTILITY_ROUTES.map((route) => ({ kind: "route" as const, ...route }))]
    : [
        ...PUBLIC_ROUTES.map((route) => ({ kind: "route" as const, ...route })),
        ...GUEST_UTILITY_ROUTES.map((route) => ({ kind: "route" as const, ...route })),
        {
          kind: "route" as const,
          href: "/login",
          label: "Sign in",
          note: "Back to your garage and listings",
          icon: "user" as const,
        },
      ];
  const familyHere = isSellingFamily(pathname);
  const indexRouteCount = indexEntries.filter((e) => e.kind === "route").length;

  return (
    <>
      <header className="bar">
        <div className="bar__inner">
          <Link className="bar__logo" href={signedIn ? "/home" : "/"} aria-label="DRVN home">
            DRVN<em>.</em> <span className="microlabel">Builds and parts</span>
          </Link>

          {/* N-2: one search field on every page, not just Explore — the bar
              is the same everywhere, including Explore and the Marketplace,
              which also carry their own scoped search below it. It submits
              to /explore, the federated view, so searching from the bar
              never makes you choose a scope first. */}
          <form action="/explore" role="search" className="bar__search">
            <SuggestingSearchField
              label="Search DRVN"
              placeholder="Search DRVN"
              endpoint="/api/explore/suggest"
            />
          </form>

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

            {/* N-3. A Post button, not a create menu: there are two things
                to make and one of them ("List a part") already lives in the
                rail, so a menu would be a menu of one. */}
            {signedIn && (
              /* It opens the quick post, which lives on Home (H-3). */
              <ButtonLink href="/home#quick-post" variant="live" className="bar__post">
                Post
              </ButtonLink>
            )}

            {/* Guests can fill a cart and check out, so the cart is theirs
                too; notifications and saved need an account. */}
            {(signedIn ? UTILITY_ROUTES : GUEST_UTILITY_ROUTES).map((route) => {
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
                  Join DRVN
                </Link>
              </>
            )}
          </nav>

          <button
            ref={indexBtnRef}
            type="button"
            className={cx("indexbtn", open && "is-open")}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="sheet-index"
            aria-haspopup="dialog"
            aria-label={open ? "Close the index" : "Open the index"}
            style={{ minHeight: 44, minWidth: 44 }}
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
        <div
          className="indexsheet"
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation index"
        >
          <div className="wrap">
            <div className="index__head">
              <span className="microlabel">Menu</span>
              {/* A section count is furniture to a visitor with three rows. */}
              {signedIn && <span className="microlabel">{indexRouteCount} sections</span>}
            </div>
            <div className="dimline-h" aria-hidden="true" />

            {/* N-2 at compact widths: the bar has no room for the search
                field there, so it leads the menu instead of disappearing.
                It's a phone's only global search outside Explore, and the
                panel is full width, so it suggests exactly like the bar's;
                it submits to the same federated /explore. */}
            {/* Mounted only while the menu is open: the closed panel stays in
                the document, and a field in it would still take a Tab stop. */}
            {open && (
              <form action="/explore" role="search" className="index__search">
                <SuggestingSearchField
                  label="Search DRVN"
                  placeholder="Search builds, parts, people"
                  endpoint="/api/explore/suggest"
                />
              </form>
            )}

            {/* N-3 at compact widths: the bar has no room for the Post button
                there, so it leads the menu instead of disappearing. */}
            {signedIn && (
              <ButtonLink
                href="/home#quick-post"
                variant="live"
                className="index__post"
                tabIndex={open ? undefined : -1}
                onClick={() => setOpen(false)}
              >
                Post
              </ButtonLink>
            )}

            <nav className="index__rows" aria-label="All sections">
              {indexEntries.map((entry, i) => {
                if (entry.kind === "group") {
                  return (
                    <p
                      key={`group-${entry.label}`}
                      className={cx("indexgroup", familyHere && "is-family")}
                      style={{ ["--i" as string]: i }}
                    >
                      <span className="indexgroup__label">{entry.label}</span>
                      <span className="indexgroup__note">{entry.note}</span>
                    </p>
                  );
                }

                const here = isActive(entry.href);
                const badge =
                  entry.href === "/offers"
                    ? offersCount
                    : entry.href === "/messages"
                      ? messagesCount
                      : 0;
                return (
                  <Link
                    key={entry.href}
                    href={entry.href}
                    className={cx("indexrow", entry.child && "indexrow--child", here && "is-here")}
                    style={{ ["--i" as string]: i }}
                    aria-current={here ? "page" : undefined}
                    tabIndex={open ? undefined : -1}
                  >
                    <span className="indexrow__ico" aria-hidden="true">
                      <Icon name={entry.icon} className="h-[18px] w-[18px]" />
                    </span>
                    <span className="indexrow__label">{entry.label}</span>
                    <span className="indexrow__note">{entry.note}</span>
                    {here ? (
                      <span className="indexrow__end chip chip--live">Here</span>
                    ) : (
                      badge > 0 && (
                        <span
                          className="indexrow__end chip chip--live"
                          aria-label={`${badge} needing your attention`}
                        >
                          {badge > 9 ? "9+" : badge}
                        </span>
                      )
                    )}
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
              {/* Signing out used to live only at the bottom of Settings. */}
              {signedIn && (
                <form action="/logout" method="post">
                  <button type="submit" className="indexlight" tabIndex={open ? undefined : -1}>
                    Log out
                  </button>
                </form>
              )}
              <Link href={signedIn ? "/sell" : "/signup"} className="btn btn--live" tabIndex={open ? undefined : -1}>
                {signedIn ? "List a part" : "Join DRVN"}
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
