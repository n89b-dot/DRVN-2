"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { NavCounts } from "@/lib/admin/queries";
import { cx } from "@/lib/format";

const LINKS = [
  ["/admin", "Overview"],
  ["/admin/disputes", "Disputes"],
  ["/admin/orders", "Orders"],
  ["/admin/listings", "Listings"],
  ["/admin/users", "Users"],
  ["/admin/reports", "Reports"],
  ["/admin/payments", "Payments"],
  ["/admin/audit", "Audit"],
] as const;

/**
 * Section nav with live queue badges — the backlog visible from anywhere in
 * the console (the Reddit-mod-queue idiom, in SheetTabs' `.n n--live`
 * count style). A badge is only ever the number of things waiting on a
 * human, so a silent nav genuinely means a clear queue.
 */
export function AdminNav({ counts }: { counts: NavCounts }) {
  const pathname = usePathname();
  const badgeFor: Record<string, number> = {
    "/admin/disputes": counts.disputes,
    "/admin/reports": counts.reports,
    "/admin/payments": counts.money,
  };
  return (
    <nav aria-label="Console sections" className="filters !mb-0">
      {LINKS.map(([href, label]) => {
        const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
        const badge = badgeFor[href] ?? 0;
        return (
          <Link
            key={href}
            href={href}
            className={cx("fbtn", active && "is-on")}
            aria-current={active ? "page" : undefined}
          >
            {label}
            {badge > 0 && (
              <span className="n n--live ml-1.5" aria-label={`${badge} waiting`}>
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
