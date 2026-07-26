"use client";

import { useTransition } from "react";

import { deleteCar } from "../../actions";

export function DangerZone({ carId, carName }: { carId: string; carName: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <section className="rounded-card border border-red-900/50 p-6">
      <h2 className="text-base font-semibold text-text-primary">Delete this car</h2>
      <p className="mt-1 text-sm text-text-muted">
        Removes the car, its photos, mods, and build updates. This cannot be undone.
      </p>
      <form
        action={(fd) => {
          if (confirm(`Delete "${carName}" and everything on it?`)) {
            startTransition(() => deleteCar(fd));
          }
        }}
        className="mt-4"
      >
        <input type="hidden" name="id" value={carId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-pill border border-red-900/60 px-5 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-950/40"
        >
          {pending ? "Deleting…" : "Delete car"}
        </button>
      </form>
    </section>
  );
}
