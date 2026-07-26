"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { cx } from "@/lib/format";
import { Icon } from "./icons";

type BarRoute = { href: string; label: string };

// Text links — the sheet's registers. Icon links follow (bell, saved, gear).
export const BAR_ROUTES: BarRoute[] = [
  { href: "/home", label: "Sheet" },
  { href: "/explore", label: "Explore" },
  { href: "/marketplace", label: "Market" },
  { href: "/garage", label: "Garage" },
  { href: "/orders", label: "Orders" },
  { href: "/profile", label: "Profile" },
];

function ThemeToggle({ initialNight }: { initialNight: boolean }) {
  // The server reads the ls-theme cookie and passes the initial state down, so
  // server and client render the same label — no hydration mismatch.
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

  return (
    <button
      type="button"
      className="bar__theme"
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

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
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
          <Link
            href="/notifications"
            className={cx("bar__link", isActive("/notifications") && "is-active")}
            aria-label="Notifications"
            title="Notifications"
          >
            <Icon name="bell" className="h-[17px] w-[17px]" />
          </Link>
          <Link
            href="/saved"
            className={cx("bar__link", isActive("/saved") && "is-active")}
            aria-label="Saved"
            title="Saved"
          >
            <Icon name="bookmark" className="h-[17px] w-[17px]" />
          </Link>
          <Link
            href="/settings"
            className={cx("bar__link", isActive("/settings") && "is-active")}
            aria-label="Settings"
            title="Settings"
          >
            <Icon name="settings" className="h-[17px] w-[17px]" />
          </Link>
          <ThemeToggle initialNight={initialNight} />
        </nav>
      </div>
    </header>
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
