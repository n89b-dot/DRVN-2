"use client";

import { useActionState, useId, useState } from "react";

import { Dialog } from "@/components/ui";

import { createCar, type ActionState } from "./actions";

/** Now on the shared Dialog primitive: dialog role, Escape, focus trap and
 *  scroll lock — the hand-rolled sheetwrap had none of the four. */
/** `quiet` — ghost button, for a garage that already has cars: adding another
 *  is a real action but not the page's job. */
export function AddCarForm({ quiet = false }: { quiet?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(createCar, {});
  const idBase = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={quiet ? "btn btn--ghost" : "btn btn--live"}
      >
        Add a car
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} label="Add a car" align="center">
        <div className="sheet text-left">
          <span className="microlabel microlabel--ink">Add a car</span>
          <p className="field__hint mt-1">
            Just the basics for now — photos, mods and updates come next.
          </p>
          <form action={action} className="mt-4">
            <div className="field">
              <label htmlFor={`${idBase}-name`} className="microlabel">
                Name
              </label>
              <input
                id={`${idBase}-name`}
                name="name"
                required
                placeholder='e.g. "Neil&apos;s Audi S4"'
                className="ctl max-w-none"
              />
            </div>
            <div className="field field--row !grid-cols-3">
              <label htmlFor={`${idBase}-year`} className="sr-only">
                Year
              </label>
              <input
                id={`${idBase}-year`}
                name="year"
                placeholder="Year"
                inputMode="numeric"
                className="ctl"
              />
              <label htmlFor={`${idBase}-make`} className="sr-only">
                Make
              </label>
              <input id={`${idBase}-make`} name="make" placeholder="Make" className="ctl" />
              <label htmlFor={`${idBase}-model`} className="sr-only">
                Model
              </label>
              <input id={`${idBase}-model`} name="model" placeholder="Model" className="ctl" />
            </div>
            {state.error && (
              <p role="alert" aria-live="polite" className="field__err">
                {state.error}
              </p>
            )}
            <div className="sheet__actions">
              <button type="submit" disabled={pending} className="btn btn--live flex-1">
                {pending ? "Adding…" : "Add the car"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="btn btn--ghost">
                Cancel
              </button>
            </div>
          </form>
        </div>
      </Dialog>
    </>
  );
}
