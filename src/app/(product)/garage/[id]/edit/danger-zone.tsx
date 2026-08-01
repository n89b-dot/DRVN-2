"use client";

import { useTransition } from "react";

import { deleteCar } from "../../actions";

export function DangerZone({ carId, carName }: { carId: string; carName: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <section className="undrawn !place-items-start text-left">
      <span className="microlabel microlabel--live">Delete this car — irreversible</span>
      <p className="!m-0 max-w-[62ch]">
        Removes the car, its build page, photos, mods and updates. Parts you&apos;ve already sold
        keep their record. This cannot be undone.
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
          {pending ? "Deleting…" : "Delete this car"}
        </button>
      </form>
    </section>
  );
}
