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
 * - `card` (public/editorial): the car is the page's content — a generous
 *   leading image beside (stacked above, on phones) the identity and actions.
 * - `manage` (Garage): a management row. ≥640px it keeps the card's generous
 *   side-by-side anatomy; on phones it recomposes to a 112px 3:2 thumbnail
 *   beside identity + state + Manage, so several cars fit one viewport.
 */
export function VehicleCard({
  vehicle,
  variant = "row",
  actions,
  flag,
}: {
  vehicle: VehicleSummary;
  variant?: "row" | "card" | "manage";
  /** Card/manage variants — the action cluster (Manage, View build, …). */
  actions?: ReactNode;
  /** Inline state chip beside the name (e.g. Private). */
  flag?: ReactNode;
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
    <div className={`vehicle ${variant === "manage" ? "vehicle--manage" : "vehicle--card"}`}>
      {media}
      <div className="vehicle__body min-w-0">
        <span className="vehicle__name vehicle__name--lg block">
          {vehicle.name}
          {flag && <span className="vehicle__flag">{flag}</span>}
        </span>
        <span className="vehicle__meta block">{meta || "No details yet"}</span>
        {actions}
      </div>
    </div>
  );
}
