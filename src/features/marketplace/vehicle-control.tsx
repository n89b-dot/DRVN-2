"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet, Button } from "@/components/ui";
import { marketplaceHref, type ListingFilters } from "@/lib/marketplace/state";
import type { VehicleFilterSelection } from "@/lib/vehicles/catalog";
import { VehicleFilterField } from "./vehicle-filter-field";

export type GarageChoice = { label: string; vehicle: string; year: string; isMain?: boolean };

/**
 * M-1 / contract 9: the main car is **offered**, never applied.
 *
 * It would be easy to default the filter to somebody's main car and call it
 * helpful. It isn't: a marketplace that silently hides most of its stock the
 * moment you sign in is a marketplace that looks empty, and the visitor has
 * no idea why. So the main car is the first one-tap choice and nothing else.
 * An explicit or URL-supplied vehicle always wins, and a cleared filter stays
 * cleared — clearing is an answer, not an absence.
 */
export function VehicleControl({ filters, selection, garage }: { filters: ListingFilters; selection: VehicleFilterSelection | null; garage: GarageChoice[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draftKey, setDraftKey] = useState(0);
  const [pending, startTransition] = useTransition();
  function close() { setOpen(false); setDraftKey(key => key + 1); }
  // First in the list, and the one the shortcut offers. `garage` already
  // arrives main-car-first (lib/cars/order.ts), so this is the same answer
  // every other surface gives — the newest car when no main car is set.
  const mainCar = garage.find(car => car.isMain) ?? garage[0] ?? null;
  function choose(vehicle?: string, vyear?: string) {
    startTransition(() => router.push(marketplaceHref(filters, { vehicle, vyear, fit: undefined, page: undefined })));
    close();
  }
  return (
    <div className="marketplace-vehicle" data-marketplace-pending={pending} aria-busy={pending}>
      {pending && <span role="status">Updating parts…</span>}
      <span>{selection ? `${filters.vyear ? `${filters.vyear} ` : ""}${selection.label}` : filters.vehicle ? "Vehicle unavailable — choose another or clear it" : "Shopping for a vehicle?"}</span>
      {/* One tap to the car you actually mean. Offered only while no vehicle
          is in play at all: once the shopper has chosen one — or cleared the
          filter on purpose — this button would be arguing with them. */}
      {!filters.vehicle && mainCar && (
        <Button variant="ghost" onClick={() => choose(mainCar.vehicle, mainCar.year)}>
          Parts for my {mainCar.label}
        </Button>
      )}
      <Button variant="ghost" onClick={() => setOpen(true)}>{selection ? "Change vehicle" : "Choose vehicle"}</Button>
      {filters.vehicle && <Button variant="ghost" onClick={() => choose()}>Clear vehicle</Button>}
      <BottomSheet open={open} onClose={close} closeLabel="Cancel" label="Choose a vehicle" align="center">
        <form key={draftKey} className="grid gap-4" onSubmit={event => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          choose(String(data.get("vehicle") ?? ""), String(data.get("vyear") ?? ""));
        }}>
          <h2 className="text-section">Choose a vehicle</h2>
          <p className="text-body text-dim">See seller-stated matches and parts from similar builds. Always confirm compatibility before buying.</p>
          {garage.length > 0 && <label className="grid gap-2">Your garage<select className="ctl w-full max-w-none" defaultValue="" onChange={event => {
            const car = garage[Number(event.currentTarget.value)];
            if (car) choose(car.vehicle, car.year);
          }}><option value="" disabled>Choose one of your cars</option>{garage.map((car, index) => <option key={`${car.vehicle}-${index}`} value={index}>{car.label}</option>)}</select></label>}
          <VehicleFilterField initial={selection} />
          <label className="grid gap-2">Vehicle year (optional)<input className="ctl w-full max-w-none" name="vyear" type="number" min="1900" max={new Date().getFullYear() + 1} defaultValue={filters.vyear ?? ""} placeholder="Year not known" /></label>
          <Button type="submit">Use vehicle</Button>
        </form>
      </BottomSheet>
    </div>
  );
}
