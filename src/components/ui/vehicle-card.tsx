import Link from "next/link";
import type { ReactNode } from "react";

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
 * The vehicle presentation shared by Home and Garage. A user's car is a
 * primary object — it gets prominent section media (large enough to read
 * body shape, stance and colour), never an order-thumbnail and never a page
 * hero.
 *
 * - `row` (Home): compact dashboard rhythm — a medium 3:2 image leading a
 *   whole-row link to the build page.
 * - `card` (Garage): the car is the page's content — a generous leading
 *   image beside (stacked above, on phones) the identity and actions.
 */
export function VehicleCard({
  vehicle,
  variant = "row",
  actions,
}: {
  vehicle: VehicleSummary;
  variant?: "row" | "card";
  /** Card variant only — the action cluster (Manage, View build, …). */
  actions?: ReactNode;
}) {
  const meta = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
  const media = (
    <span className="vehicle__img">
      <Media
        src={vehicle.cover_image_url ?? undefined}
        alt={vehicle.name}
        className="h-full w-full"
        fallbackClassName="plate-undrawn"
        role="vehicle"
      />
    </span>
  );

  if (variant === "row") {
    return (
      <Link href={`/cars/${vehicle.slug}`} className="vehicle vehicle--row">
        {media}
        <span className="vehicle__body min-w-0">
          <span className="vehicle__name block">{vehicle.name}</span>
          <span className="vehicle__meta block">{meta || "View the build page"}</span>
        </span>
        <span className="vehicle__go" aria-hidden="true">
          →
        </span>
      </Link>
    );
  }

  return (
    <div className="vehicle vehicle--card">
      {media}
      <div className="vehicle__body min-w-0">
        <span className="vehicle__name vehicle__name--lg block">{vehicle.name}</span>
        <span className="vehicle__meta block">{meta || "No details yet"}</span>
        {actions}
      </div>
    </div>
  );
}
