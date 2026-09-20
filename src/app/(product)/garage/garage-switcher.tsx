import { FilterGroup, FilterLink, Media } from "@/components/ui";

import type { GarageSheet } from "./garage-data";

/**
 * G-1 — the switcher strip: every car, main first, plus All cars and one
 * Add vehicle.
 *
 * `FilterGroup scroll` + `FilterLink` rather than a new component: it is a
 * row of links that scrolls sideways on a phone, which is exactly what that
 * pair already does. The thumbnails are `Media` children inside the links.
 *
 * "All cars" is the list the garage has always been, kept as a destination
 * rather than replaced — with four cars the overview is still the useful
 * view, and the focused one is for when you are working on one of them.
 */
export function GarageSwitcher({
  sheets,
  currentCarId,
}: {
  sheets: GarageSheet[];
  currentCarId?: string;
}) {
  if (sheets.length === 0) return null;
  return (
    <div className="garageswitch">
      <FilterGroup label="Cars" ariaLabel="Choose a car" stack scroll>
        <FilterLink href="/garage" selected={!currentCarId}>
          All cars
        </FilterLink>
        {sheets.map((sheet) => (
          <FilterLink
            key={sheet.id}
            href={`/garage?car=${sheet.id}`}
            selected={currentCarId === sheet.id}
          >
            <Media
              src={sheet.cover_image_url ?? undefined}
              alt=""
              className="garageswitch__thumb"
              role="avatar"
            />
            {sheet.name}
          </FilterLink>
        ))}
        <FilterLink href="/garage#add-car" selected={false}>
          + Add vehicle
        </FilterLink>
      </FilterGroup>
    </div>
  );
}
