import Link from "next/link";

export const metadata = { title: "Not found - DRVN" };

export default function ProductNotFound() {
  return (
    <div className="wrap">
      <div className="undrawn undrawn--hero">
        <span className="undrawn__mark" aria-hidden="true">
          ⌕
        </span>
        <h3>Not on your sheet</h3>
        <p>
          This page doesn&apos;t exist, or it belongs to someone else — orders, listings and garage
          pages are only visible to the people on them.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Link href="/home" className="btn btn--live">
            Your sheet
          </Link>
          <Link href="/orders" className="btn btn--ghost">
            Your orders
          </Link>
        </div>
      </div>
    </div>
  );
}
