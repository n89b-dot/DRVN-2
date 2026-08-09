"use client";

import { useActionState } from "react";

import type { Car } from "@/lib/database.types";

import { updateCar, type ActionState } from "../../actions";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field !mb-0">
      <span className="microlabel">{label}</span>
      {children}
    </label>
  );
}

export function CarDetailsForm({ car }: { car: Car }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateCar, {});

  return (
    <section className="tile">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">Details — shown on the build page</span>
      </div>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={car.id} />
        <Field label="Name">
          <input name="name" defaultValue={car.name} required className="ctl max-w-none" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Year">
            <input name="year" defaultValue={car.year ?? ""} inputMode="numeric" className="ctl" />
          </Field>
          <Field label="Make">
            <input name="make" defaultValue={car.make ?? ""} className="ctl" />
          </Field>
          <Field label="Model">
            <input name="model" defaultValue={car.model ?? ""} className="ctl" />
          </Field>
        </div>
        <Field label="VIN — optional, verifies the fields above">
          <input
            name="vin"
            defaultValue={car.vin ?? ""}
            maxLength={17}
            placeholder="17 characters, on the windshield or door jamb"
            autoCapitalize="characters"
            spellCheck={false}
            className="ctl max-w-none font-mono uppercase"
          />
          <span className="field__hint">
            We decode it once (via the US NHTSA database) to fill and verify year, make, model,
            trim and engine — that&apos;s what &quot;fits your car&quot; checks against. Never shown
            publicly.
          </span>
          {car.vin_decoded_at && (
            <span className="field__hint">
              ✓ Decoded{car.trim ? ` — ${car.trim}` : ""}
              {car.engine ? ` · ${car.engine}` : ""}
              {car.drivetrain ? ` · ${car.drivetrain}` : ""}
            </span>
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Color">
            <input name="color" defaultValue={car.color ?? ""} className="ctl" />
          </Field>
          <Field label="Tags — comma separated">
            <input
              name="tags"
              defaultValue={car.tags.join(", ")}
              placeholder="Bagged, FBO, Show car"
              className="ctl max-w-none"
            />
          </Field>
        </div>
        <Field label="About">
          <textarea
            name="about"
            defaultValue={car.about ?? ""}
            rows={4}
            className="ctl"
            placeholder="What's the story with this car?"
          />
        </Field>
        <label className="flex items-center gap-2 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">
          <input type="checkbox" name="is_public" defaultChecked={car.is_public} className="sq" />
          Public sheet — anyone can read it
        </label>
        {state.error && (
          <p role="alert" aria-live="polite" className="field__err">
            {state.error}
          </p>
        )}
        <div className="flex justify-end">
          <button type="submit" disabled={pending} className="btn btn--live">
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </section>
  );
}
