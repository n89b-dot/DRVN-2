"use client";

import { useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";

import { Button, TextArea, TextField } from "@/components/ui";
import type { Car } from "@/lib/database.types";

import { updateCar, type ActionState } from "../../actions";

export function CarDetailsForm({ car }: { car: Car }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const revision = useRef(0);
  const [dirty, setDirty] = useState(false);

  return (
    <section className="tile">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">Details — shown on the build page</span>
      </div>
      <form className="flex flex-col gap-4" onChange={() => { revision.current += 1; setDirty(true); }} onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current) return;
        const data = new FormData(event.currentTarget);
        const submittedRevision = revision.current;
        submitting.current = true;
        setPending(true);
        setState({});
        try {
          const result = await updateCar({}, data);
          setState(result);
          if (result.ok && revision.current === submittedRevision) setDirty(false);
        } catch (error) {
          unstable_rethrow(error);
          setState({ error: "Couldn’t confirm the save. Your changes are still here; try again." });
        } finally {
          submitting.current = false;
          setPending(false);
        }
      }}>
        <input type="hidden" name="id" value={car.id} />
        <TextField
          id="car-name"
          label="Name"
          name="name"
          defaultValue={car.name}
          required
          className="max-w-none"
          fieldClassName="!mb-0"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            id="car-year"
            label="Year"
            name="year"
            defaultValue={car.year ?? ""}
            inputMode="numeric"
            fieldClassName="!mb-0"
          />
          <TextField
            id="car-make"
            label="Make"
            name="make"
            defaultValue={car.make ?? ""}
            fieldClassName="!mb-0"
          />
          <TextField
            id="car-model"
            label="Model"
            name="model"
            defaultValue={car.model ?? ""}
            fieldClassName="!mb-0"
          />
        </div>
        {/* Left manual: TextField renders a single hint slot, and this field
            carries two — the decode explainer plus the conditional "✓ Decoded"
            line. */}
        <label className="field !mb-0">
          <span className="microlabel">VIN — optional, verifies the fields above</span>
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
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id="car-color"
            label="Color"
            name="color"
            defaultValue={car.color ?? ""}
            fieldClassName="!mb-0"
          />
          <TextField
            id="car-tags"
            label="Tags — comma separated"
            name="tags"
            defaultValue={car.tags.join(", ")}
            placeholder="Bagged, FBO, Show car"
            className="max-w-none"
            fieldClassName="!mb-0"
          />
        </div>
        <TextArea
          id="car-about"
          label="About"
          name="about"
          defaultValue={car.about ?? ""}
          rows={4}
          placeholder="What's the story with this car?"
          fieldClassName="!mb-0"
        />
        <label className="flex items-center gap-2 font-mono text-micro uppercase tracking-[0.1em] text-dim">
          <input type="checkbox" name="is_public" defaultChecked={car.is_public} className="sq" />
          Public sheet — anyone can read it
        </label>
        {state.error && (
          <p role="alert" aria-live="polite" className="field__err">
            {state.error}
          </p>
        )}
        {!dirty && !pending && !state.error && state.ok && (
          <p role="status" aria-live="polite" className="field__ok !block">
            {state.ok}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" variant="live" loading={pending} pendingLabel="Saving…">
            Save changes
          </Button>
        </div>
      </form>
    </section>
  );
}
