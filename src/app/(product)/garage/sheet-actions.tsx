import Link from "next/link";

import { ButtonLink } from "@/components/ui";

/**
 * The sheet's tool rail. Post update is the one button — the live fill, the
 * thing that moves a build forward. Manage and List a part are quiet links
 * beside it: with two cars, three equal buttons per sheet was six identical
 * controls in a column, and the sheet's name already opens the car.
 */
export function SheetActions({ carId }: { carId: string }) {
  return (
    <div className="gsheet__rail">
      <ButtonLink href={`/garage/${carId}/update/new`} variant="live">
        Post update
      </ButtonLink>
      <Link href={`/garage/${carId}/edit`} className="jumplink">
        Manage
      </Link>
      <Link href={`/sell?car=${carId}`} className="jumplink">
        List a part
      </Link>
    </div>
  );
}
