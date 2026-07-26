"use client";

import { useActionState, useState } from "react";

import { createCar, type ActionState } from "./actions";

export function AddCarForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(createCar, {});

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn--live">
        Open a sheet
      </button>

      {open && (
        <div className="sheetwrap is-open" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="sheet text-left">
            <span className="microlabel microlabel--ink">Open a sheet</span>
            <p className="field__hint mt-1">
              Just the basics — the sheet fills itself as you go.
            </p>
            <form action={action} className="mt-4">
              <div className="field">
                <span className="microlabel">Name</span>
                <input name="name" required placeholder='e.g. "Neil&apos;s Audi S4"' className="ctl max-w-none" />
              </div>
              <div className="field field--row !grid-cols-3">
                <input name="year" placeholder="Year" inputMode="numeric" className="ctl" />
                <input name="make" placeholder="Make" className="ctl" />
                <input name="model" placeholder="Model" className="ctl" />
              </div>
              {state.error && (
                <p role="alert" aria-live="polite" className="field__err">
                  {state.error}
                </p>
              )}
              <div className="sheet__actions">
                <button type="submit" disabled={pending} className="btn btn--live flex-1">
                  {pending ? "Opening…" : "Open the sheet"}
                </button>
                <button type="button" onClick={() => setOpen(false)} className="btn btn--ghost">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
