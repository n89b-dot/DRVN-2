"use client";

import { useActionState } from "react";

import type { Car } from "@/lib/database.types";

import { updateCar, type ActionState } from "../../actions";

const inputClass =
  "h-11 w-full rounded-input border border-border bg-app px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      {children}
    </label>
  );
}

export function CarDetailsForm({ car }: { car: Car }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateCar, {});

  return (
    <section className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-base font-semibold text-text-primary">Details</h2>
      <form action={action} className="mt-5 flex flex-col gap-4">
        <input type="hidden" name="id" value={car.id} />
        <Field label="Name">
          <input name="name" defaultValue={car.name} required className={inputClass} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Year">
            <input name="year" defaultValue={car.year ?? ""} inputMode="numeric" className={inputClass} />
          </Field>
          <Field label="Make">
            <input name="make" defaultValue={car.make ?? ""} className={inputClass} />
          </Field>
          <Field label="Model">
            <input name="model" defaultValue={car.model ?? ""} className={inputClass} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Color">
            <input name="color" defaultValue={car.color ?? ""} className={inputClass} />
          </Field>
          <Field label="Tags (comma-separated)">
            <input
              name="tags"
              defaultValue={car.tags.join(", ")}
              placeholder="Bagged, FBO, Show car"
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="About">
          <textarea
            name="about"
            defaultValue={car.about ?? ""}
            rows={4}
            className="w-full resize-y rounded-input border border-border bg-app px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
            placeholder="What's the story with this car?"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" name="is_public" defaultChecked={car.is_public} className="accent-[#3B71FE]" />
          Public — anyone can view this car&apos;s page
        </label>
        {state.error && <p className="text-sm text-red-400">{state.error}</p>}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="rounded-pill bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90"
          >
            {pending ? "Saving…" : "Save details"}
          </button>
        </div>
      </form>
    </section>
  );
}
