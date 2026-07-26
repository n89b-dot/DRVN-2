import Link from "next/link";

export const metadata = { title: "Not found - DRVN" };

/** Branded 404. `notFound()` was called correctly but rendered Next's default. */
export default function NotFound() {
  return (
    <div className="wrap">
      <div className="undrawn undrawn--hero">
        <span className="undrawn__mark" aria-hidden="true">
          ⌕
        </span>
        <h3>No sheet at this reference</h3>
        <p>
          The page you asked for doesn&apos;t exist, or whoever drew it has taken it down.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Link href="/marketplace" className="btn btn--live">
            Browse the market
          </Link>
          <Link href="/explore" className="btn btn--ghost">
            Explore sheets
          </Link>
        </div>
      </div>
    </div>
  );
}
