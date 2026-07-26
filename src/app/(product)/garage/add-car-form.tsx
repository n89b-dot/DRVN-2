"use client";

import { useActionState, useState } from "react";

import { createCar, type ActionState } from "./actions";

const inputClass =
  "h-11 rounded-input border border-border bg-app px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent";

export function AddCarForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(createCar, {});

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-pill bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90"
      >
        Add a car
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-5"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="w-full max-w-[400px] rounded-card border border-border bg-surface p-6">
            <h2 className="text-lg font-semibold text-text-primary">Add a car</h2>
            <p className="mt-1 text-sm text-text-muted">
              Just the basics — you can fill in the rest after.
            </p>
            <form action={action} className="mt-5 flex flex-col gap-3">
              <input name="name" required placeholder='Name (e.g. "Neil&apos;s Audi S4")' className={inputClass} />
              <div className="grid gap-3 min-[420px]:grid-cols-3">
                <input name="year" placeholder="Year" inputMode="numeric" className={inputClass} />
                <input name="make" placeholder="Make" className={inputClass} />
                <input name="model" placeholder="Model" className={inputClass} />
              </div>
              {state.error && <p className="text-sm text-red-400">{state.error}</p>}
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-pill px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-pill bg-accent px-5 py-2 text-sm font-semibold text-white transition hover:bg-accent/90"
                >
                  {pending ? "Adding…" : "Add car"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
