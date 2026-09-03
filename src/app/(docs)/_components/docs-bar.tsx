"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useSyncExternalStore } from "react";

import { cx } from "@/lib/format";
import { Icon } from "@/components/ui";

export const DOCS_SECTIONS = [
  { href: "/docs", label: "Overview" },
  { href: "/docs/brand", label: "Brand" },
  { href: "/docs/design-system", label: "System" },
  { href: "/docs/typography", label: "Type" },
  { href: "/docs/components", label: "Components" },
  { href: "/docs/motion", label: "Motion" },
  { href: "/docs/patterns", label: "Patterns" },
  { href: "/docs/rules", label: "Rules" },
  { href: "/docs/material", label: "Material" },
  { href: "/docs/implementation", label: "Progress" },
];

/**
 * The microsite's own chrome — deliberately not LivesheetBar or AdminNav, so
 * the whole (docs) group can lift onto a separate origin later without
 * dragging product navigation along. Same .bar idiom and the same ls-theme
 * cookie as everywhere else.
 */
export function DocsBar({ initialNight = false }: { initialNight?: boolean }) {
  const pathname = usePathname();

  // Same DOM-truth pattern as LivesheetBar: the root layout's inline script
  // stamps data-theme pre-paint; we read it after hydration.
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

  const isActive = (href: string) =>
    href === "/docs" ? pathname === "/docs" : pathname.startsWith(href);

  return (
    <header className="bar">
      <div className="bar__inner">
        <Link className="bar__logo" href="/docs" aria-label="DRVN docs home">
          DRVN<em>.</em> <span className="microlabel">Design &amp; docs</span>
        </Link>

        <nav className="bar__nav" aria-label="Documentation">
          {DOCS_SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className={cx("bar__link", "bar__link--text", isActive(section.href) && "is-active")}
              aria-current={isActive(section.href) ? "page" : undefined}
            >
              {section.label}
            </Link>
          ))}

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
        </nav>
      </div>
    </header>
  );
}
