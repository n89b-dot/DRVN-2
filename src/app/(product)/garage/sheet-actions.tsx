import Link from "next/link";

/**
 * The sheet's tool rail — three tools, one grammar. Post update carries the
 * live fill (the sheet's one red control: the thing that moves a build
 * forward); Manage and List a part are ghosts.
 */
export function SheetActions({ carId }: { carId: string }) {
  return (
    <div className="gsheet__rail">
      <Link href={`/garage/${carId}/edit`} className="btn btn--ghost">
        Manage
      </Link>
      <Link href={`/sell?car=${carId}`} className="btn btn--ghost">
        List a part
      </Link>
      <Link href={`/garage/${carId}/update/new`} className="btn btn--live">
        Post update
      </Link>
    </div>
  );
}
