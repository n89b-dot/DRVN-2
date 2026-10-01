import Link from "next/link";

import { vehicleSubline } from "@/lib/vehicles/label";

import { Media } from "./primitives";

export type VehicleSummary = {
  id: string;
  slug: string;
  name: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  cover_image_url?: string | null;
};

/**
 * The vehicle-as-a-row presentation (Home dashboard). A user's car is a
 * primary object — it gets prominent section media (large enough to read
 * body shape, stance and colour), never an order-thumbnail: a medium 3:2
 * image leading a whole-row link to the build page.
 *
 * The Garage's management card is deliberately NOT this component — it's the
 * feature-level `GarageSheetCard` (`.gsheet`), which carries dims, notes,
 * latest-update and order anatomy no other surface needs. (The old unused
 * `card`/`manage` variants that claimed that job were removed.)
 */
export function VehicleCard({
  vehicle,
  stats,
  href,
}: {
  vehicle: VehicleSummary;
  /** The build's pulse: updates posted and followers. */
  stats?: { updates: number; followers: number };
  /** Overrides the build-page link when the caller carries navigation
   *  context, e.g. a listing's "Came off this car" keeps its way back. */
  href?: string;
}) {
  const meta = vehicleSubline(vehicle.name, vehicle);
  return (
    <Link href={href ?? `/cars/${vehicle.slug}`} className="vehicle vehicle--row">
      <span className="vehicle__img">
        <Media
          src={vehicle.cover_image_url ?? undefined}
          alt={vehicle.name}
          className="h-full w-full"
          fallbackClassName="plate-undrawn"
          role="vehicle"
        />
      </span>
      <span className="vehicle__body min-w-0">
        <span className="vehicle__name block">{vehicle.name}</span>
        {meta && <span className="vehicle__meta vref vref--lg block">{meta}</span>}
        {stats && (
          <span className="vehicle__stats">
            <span className="vehicle__stat">
              {stats.updates} update{stats.updates === 1 ? "" : "s"}
            </span>
            <span className="vehicle__statdot" aria-hidden="true">
              ·
            </span>
            <span className="vehicle__stat">
              {stats.followers} follower{stats.followers === 1 ? "" : "s"}
            </span>
          </span>
        )}
      </span>
      <span className="vehicle__go" aria-hidden="true">
        →
      </span>
    </Link>
  );
}
