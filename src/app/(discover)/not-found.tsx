import Link from "next/link";

export const metadata = { title: "Not found - DRVN" };

/** Discovery-scoped 404: keeps the shell and points back at the market. */
export default function DiscoverNotFound() {
  return (
    <div className="wrap">
      <div className="undrawn undrawn--hero">
        <span className="undrawn__mark" aria-hidden="true">
          ⌕
        </span>
        <h3>Nothing here</h3>
        <p>
          This car, part or profile isn&apos;t around — it may have sold, been taken down, or
          never existed.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Link href="/marketplace" className="btn btn--live">
            Browse parts
          </Link>
          <Link href="/explore" className="btn btn--ghost">
            Explore builds
          </Link>
        </div>
      </div>
    </div>
  );
}
