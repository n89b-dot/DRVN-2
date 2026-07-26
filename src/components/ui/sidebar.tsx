"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/lib/format";
import { Icon, type IconName } from "./icons";

export type SidebarRoute = {
  href: string;
  icon: IconName;
  label: string;
};

export const PRIMARY_ROUTES: SidebarRoute[] = [
  { href: "/home", icon: "home", label: "Home" },
  { href: "/explore", icon: "compass", label: "Explore" },
  { href: "/marketplace", icon: "market", label: "Marketplace" },
  { href: "/garage", icon: "garage", label: "Garage" },
  { href: "/profile", icon: "user", label: "Profile" },
];

export const UTILITY_ROUTES: SidebarRoute[] = [
  { href: "/notifications", icon: "bell", label: "Notifications" },
  { href: "/saved", icon: "bookmark", label: "Saved" },
  { href: "/settings", icon: "settings", label: "Settings" },
];

export function AppSidebar() {
  const pathname = usePathname();

  const renderItem = (item: SidebarRoute) => {
    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.href}
        href={item.href}
        title={item.label}
        aria-label={item.label}
        aria-current={isActive ? "page" : undefined}
        className={cx(
          "grid h-11 w-11 place-items-center rounded-xl transition",
          isActive
            ? "bg-raised text-text-primary"
            : "text-text-muted hover:bg-white/5 hover:text-text-secondary",
        )}
      >
        <Icon name={item.icon} />
      </Link>
    );
  };

  return (
    <aside className="sticky top-0 z-40 flex h-screen w-[72px] shrink-0 flex-col items-center justify-between border-r border-white/10 bg-surface py-5 md:w-24">
      <div className="flex flex-col items-center gap-6">
        <Link
          href="/home"
          className="grid h-10 w-10 place-items-center rounded-2xl bg-accent font-brand text-lg font-bold text-white"
          aria-label="DRVN home"
        >
          D
        </Link>
        <nav className="flex flex-col items-center gap-2">{PRIMARY_ROUTES.map(renderItem)}</nav>
      </div>
      <nav className="flex flex-col items-center gap-2">{UTILITY_ROUTES.map(renderItem)}</nav>
    </aside>
  );
}
