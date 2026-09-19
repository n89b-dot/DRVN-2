"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui";
import { markModRemoved } from "@/features/activity/mod-actions";

/**
 * A-3, the offer half: this update says a part came off, and the sheet still
 * has it fitted.
 *
 * Deliberately an offer and not a consequence. Publishing an update is
 * story-telling; the mod sheet is a record. Letting the first rewrite the
 * second automatically would mean a mistyped block quietly strips a part off
 * a build — and the part might genuinely still be on the car while the owner
 * writes about taking it off next weekend. Owner-only, dismissible, and
 * ignoring it costs nothing.
 */
export function MarkRemovedOffer({
  carId,
  mods,
}: {
  carId: string;
  mods: { id: string; label: string }[];
}) {
  const [done, setDone] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [working, setWorking] = useState<string | null>(null);

  const open = mods.filter((m) => !done.includes(m.id) && !dismissed.includes(m.id));
  if (open.length === 0) return null;

  function mark(mod: { id: string; label: string }) {
    setError(null);
    setWorking(mod.id);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("mod_item_id", mod.id);
      formData.set("car_id", carId);
      const result = await markModRemoved({}, formData);
      if (result?.error) setError(result.error);
      else setDone((d) => [...d, mod.id]);
      setWorking(null);
    });
  }

  return (
    <div className="modrow__ask mt-8" role="group" aria-label="Update the build sheet">
      <span className="microlabel">
        This update says {open.length === 1 ? "a part" : "some parts"} came off. Still on the
        sheet:
      </span>
      {open.map((mod) => (
        <span key={mod.id} className="flex flex-wrap items-center gap-2">
          <span className="text-body">{mod.label}</span>
          <Button
            variant="ghost"
            onClick={() => mark(mod)}
            disabled={pending && working === mod.id}
          >
            {pending && working === mod.id ? "Marking…" : "Mark it off the car"}
          </Button>
          <button
            type="button"
            className="microlabel underline decoration-dotted transition hover:text-live"
            onClick={() => setDismissed((d) => [...d, mod.id])}
            aria-label={`Leave ${mod.label} on the sheet`}
          >
            Leave it
          </button>
        </span>
      ))}
      {error && (
        <span role="alert" className="field__err block w-full">
          {error}
        </span>
      )}
    </div>
  );
}
