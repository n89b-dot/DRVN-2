import type { ReactNode } from "react";

import { FilterGroup, FilterLink, Media } from "@/components/ui";

import type { GarageSheet } from "./garage-data";
import { SwitcherFocus } from "./switcher-focus";

/**
 * G-1 — the switcher strip: every car, main first, plus All cars. (Add a
 * car lives in the page head, where a phone can see it; `add` remains for
 * a caller that wants it in the strip.)
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
  add,
}: {
  sheets: GarageSheet[];
  currentCarId?: string;
  /** The one Add vehicle control (G-1) — the real dialog trigger, mounted
   *  at the end of the strip rather than linked to from it. */
  add?: ReactNode;
}) {
  if (sheets.length === 0) return null;
  return (
    <div className="garageswitch">
      <FilterGroup label="Cars" ariaLabel="Choose a car" stack scroll>
        <FilterLink href="/garage?car=all" selected={!currentCarId}>
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
        {add}
      </FilterGroup>
      <SwitcherFocus carId={currentCarId} />
    </div>
  );
}
