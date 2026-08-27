import Link from "next/link";

import { EmptyState } from "@/components/ui";

export const metadata = { title: "Not found - DRVN" };

export default function ProductNotFound() {
  return (
    <div className="wrap">
      <EmptyState
        mark="⌕"
        title="Not yours to see"
        className="undrawn--hero"
        action={
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link href="/home" className="btn btn--live">
              Home
            </Link>
            <Link href="/orders" className="btn btn--ghost">
              Your orders
            </Link>
          </div>
        }
      >
        This page doesn&apos;t exist, or it belongs to someone else — orders, listings and
        garage pages are only visible to the people on them.
      </EmptyState>
    </div>
  );
}
