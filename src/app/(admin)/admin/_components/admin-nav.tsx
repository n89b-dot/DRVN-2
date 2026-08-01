"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Console sections" className="filters !mb-0">
      {LINKS.map(([href, label]) => {
        const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cx("fbtn", active && "is-on")}
            aria-current={active ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
