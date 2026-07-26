"use client";

import { useTransition } from "react";

import { deleteCar } from "../../actions";

export function DangerZone({ carId, carName }: { carId: string; carName: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <section className="undrawn !place-items-start text-left">
      <span className="microlabel microlabel--live">Closing the sheet — irreversible</span>
      <p className="!m-0 max-w-[62ch]">
        Removes the car, its photos, mods, and build updates. Provenance on parts already sold
        stays with them. This cannot be undone.
      </p>
      <form
        action={(fd) => {
          if (confirm(`Delete "${carName}" and everything on it?`)) {
            startTransition(() => deleteCar(fd));
          }
        }}
      >
        <input type="hidden" name="id" value={carId} />
        <button type="submit" disabled={pending} className="btn btn--ghost !text-live">
          {pending ? "Deleting…" : "Close the sheet"}
        </button>
      </form>
    </section>
  );
}
