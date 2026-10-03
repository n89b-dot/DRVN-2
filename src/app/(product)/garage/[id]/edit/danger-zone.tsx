"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { ConfirmDialog } from "@/components/ui";

import { deleteCar, type ActionState } from "../../actions";

export function DangerZone({ carId, carName }: { carId: string; carName: string }) {
  const router = useRouter();
  const submitting = useRef(false);
  const [state, setState] = useState<ActionState>({});
  const [pending, setPending] = useState(false);
  // A transition, so a redirect the action already followed (sign-in lapsed)
  // lands in Next's redirect boundary instead of a second navigation.
  const [, startTransition] = useTransition();

  function submit(data: FormData) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setState({});
    startTransition(async () => {
      try {
        const result = await deleteCar({}, data);
        setState(result);
        if (result.href) router.push(result.href);
      } catch (error) {
        unstable_rethrow(error);
        setState({ error: "Couldn’t confirm the deletion. Try again to check the same car." });
      } finally {
        submitting.current = false;
        setPending(false);
      }
    });
  }

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
        onSubmit={submit}
        hidden={{ id: carId }}
        pending={pending}
        error={state.error}
        // The purpose-built destructive trigger (red outline, transparent
        // ground), and a typed gate for the irreversible tier.
        triggerClassName="btn btn--destructive"
        confirmText={carName}
      >
        {pending ? "Deleting…" : "Delete this car"}
      </ConfirmDialog>
    </section>
  );
}
