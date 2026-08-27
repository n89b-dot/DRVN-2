import Link from "next/link";

import { EmptyState } from "@/components/ui";

export const metadata = { title: "Not found - DRVN" };

/** Discovery-scoped 404: keeps the shell and points back at the market. */
export default function DiscoverNotFound() {
  return (
    <div className="wrap">
      <EmptyState
        mark="⌕"
        title="Nothing here"
        className="undrawn--hero"
        action={
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link href="/marketplace" className="btn btn--live">
              Browse parts
            </Link>
            <Link href="/explore" className="btn btn--ghost">
              Explore builds
            </Link>
          </div>
        }
      >
        This car, part or profile isn&apos;t around — it may have sold, been taken down, or
        never existed.
      </EmptyState>
    </div>
  );
}
