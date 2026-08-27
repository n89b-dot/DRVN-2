import Link from "next/link";

import { EmptyState } from "@/components/ui";

export const metadata = { title: "Not found - DRVN" };

/** Branded 404. `notFound()` was called correctly but rendered Next's default. */
export default function NotFound() {
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
        That page doesn&apos;t exist, or whoever posted it has taken it down.
      </EmptyState>
    </div>
  );
}
