import Link from "next/link";

/**
 * The sheet's tool rail — three equal tools, one grammar. Manage is the
 * ink-filled one (where photos, mods and the build page are edited); the
 * other two are the sheet's verbs. Nothing here says "view build": the
 * plate and the car's name already go there.
 */
export function SheetActions({ carId }: { carId: string }) {
  return (
    <div className="gsheet__rail">
      <Link href={`/garage/${carId}/edit`} className="btn">
        Manage
      </Link>
      <Link href={`/sell?car=${carId}`} className="btn btn--ghost">
        List a part
      </Link>
      <Link href={`/garage/${carId}/update/new`} className="btn btn--ghost">
        Post update
      </Link>
    </div>
  );
}
