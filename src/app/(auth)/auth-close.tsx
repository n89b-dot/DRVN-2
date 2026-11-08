"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The gate's way out. Not on onboarding: closing there left a new account
 * with no @handle (profile link /u/null) that could still post and trade.
 * Choosing a username is the one step that can't be skipped.
 */
export function AuthClose() {
  const pathname = usePathname();
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) return null;
  // N686: nor on the earlier member's one-time 18+ question; its way out is Sign out.
  if (pathname === "/confirm-age") return null;
  return (
    <Link href="/" className="authtop__plate authtop__close">
      <span aria-hidden="true">×</span> Close
    </Link>
  );
}
