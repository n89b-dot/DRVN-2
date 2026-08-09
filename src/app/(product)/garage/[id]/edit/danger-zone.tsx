"use client";

import { useTransition } from "react";

import { ConfirmDialog } from "@/components/ui";

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
      <ConfirmDialog
        title={`Delete "${carName}"?`}
        destructive
        consequences={[
          "Removes the car, its build page, photos, mods and updates permanently",
          "Parts you've already sold keep their listing record",
          "This cannot be undone",
        ]}
        confirmLabel={pending ? "Deleting…" : "Delete this car"}
        formAction={(fd) => startTransition(() => deleteCar(fd))}
        hidden={{ id: carId }}
        pending={pending}
        triggerClassName="btn btn--ghost !text-live"
      >
        {pending ? "Deleting…" : "Delete this car"}
      </ConfirmDialog>
    </section>
  );
}
