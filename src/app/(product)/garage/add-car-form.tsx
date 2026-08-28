"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import { Button, ComboField, Dialog, Select, TextField, type ComboOption } from "@/components/ui";

import { createCar, type ActionState } from "./actions";

/**
 * Add Car (brief §E). The primary path is choosing the vehicle — year, then a
 * searchable make, then a searchable model from the DRVN catalog — so a new
 * car lands as a recognized vehicle instead of invented strings. "Enter VIN
 * instead" is the shortcut; "Enter it manually" is the always-available
 * fallback for kit/import/gray-market cars. A personal name is optional in
 * every mode — unnamed, the car is called what it is.
 */

type Mode = "picker" | "vin" | "manual";

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR + 2 - 1930 }, (_, index) => THIS_YEAR + 1 - index);

type MakeOption = { id: number; name: string };
type ModelOption = { id: number; name: string; aliases?: string[] };

export function AddCarForm({ quiet = false }: { quiet?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("picker");
  const [state, action, pending] = useActionState<ActionState, FormData>(createCar, {});
  const idBase = useId();

  const [makes, setMakes] = useState<MakeOption[] | null>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [makeId, setMakeId] = useState<number | null>(null);
  const [modelId, setModelId] = useState<number | null>(null);
  const modelsFor = useRef<number | null>(null);

  // Makes load once, when the dialog first opens — not on page load.
  useEffect(() => {
    if (!open || makes !== null) return;
    let cancelled = false;
    fetch("/api/vehicles/catalog/makes")
      .then((res) => (res.ok ? res.json() : { makes: [] }))
      .then((data) => {
        if (!cancelled) setMakes(data.makes ?? []);
      })
      .catch(() => {
        if (!cancelled) setMakes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, makes]);

  // Models follow the chosen make.
  useEffect(() => {
    if (makeId === null || modelsFor.current === makeId) return;
    modelsFor.current = makeId;
    setModels(null);
    let cancelled = false;
    fetch(`/api/vehicles/catalog/models?make=${makeId}`)
      .then((res) => (res.ok ? res.json() : { models: [] }))
      .then((data) => {
        if (!cancelled && modelsFor.current === makeId) setModels(data.models ?? []);
      })
      .catch(() => {
        if (!cancelled && modelsFor.current === makeId) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [makeId]);

  const makeOptions: ComboOption[] = (makes ?? []).map((make) => ({
    id: make.id,
    label: make.name,
  }));
  const modelOptions: ComboOption[] = (models ?? []).map((model) => ({
    id: model.id,
    label: model.name,
    keywords: model.aliases,
  }));

  const manualLink = (
    <button type="button" className="jumplink" onClick={() => setMode("manual")}>
      Can&rsquo;t find your vehicle? Enter it manually
    </button>
  );

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
            {mode === "picker" && "Find the actual vehicle — photos, mods and updates come next."}
            {mode === "vin" && "Your VIN stays private. Decoding it identifies the car."}
            {mode === "manual" &&
              "Type it your way — kit cars, imports and one-offs are welcome here."}
          </p>

          <form action={action} className="mt-4">
            <input type="hidden" name="mode" value={mode} />

            {mode === "picker" && (
              <>
                <input type="hidden" name="catalog_make_id" value={makeId ?? ""} />
                <input type="hidden" name="catalog_model_id" value={modelId ?? ""} />
                <Select id={`${idBase}-year`} label="Year" name="year" defaultValue="">
                  <option value="">Year — optional</option>
                  {YEARS.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </Select>
                <ComboField
                  id={`${idBase}-make`}
                  label="Make"
                  options={makeOptions}
                  value={makeId}
                  loading={open && makes === null}
                  placeholder="Search makes…"
                  onChange={(option) => {
                    setMakeId(option ? Number(option.id) : null);
                    setModelId(null);
                  }}
                  footer={manualLink}
                />
                <ComboField
                  id={`${idBase}-model`}
                  label="Model"
                  options={modelOptions}
                  value={modelId}
                  disabled={makeId === null}
                  loading={makeId !== null && models === null}
                  placeholder={makeId === null ? "Pick a make first" : "Search models…"}
                  onChange={(option) => setModelId(option ? Number(option.id) : null)}
                  footer={manualLink}
                />
              </>
            )}

            {mode === "vin" && (
              <TextField
                id={`${idBase}-vin`}
                label="VIN"
                name="vin"
                required
                minLength={11}
                maxLength={17}
                autoComplete="off"
                spellCheck={false}
                placeholder="17 characters on modern cars"
                className="max-w-none font-mono uppercase"
                hint="Never shown publicly — decoded via the NHTSA register."
              />
            )}

            {mode === "manual" && (
              <div className="field field--row !grid-cols-3">
                <label htmlFor={`${idBase}-year-m`} className="sr-only">
                  Year
                </label>
                <input
                  id={`${idBase}-year-m`}
                  name="year"
                  placeholder="Year"
                  inputMode="numeric"
                  className="ctl"
                />
                <label htmlFor={`${idBase}-make-m`} className="sr-only">
                  Make
                </label>
                <input id={`${idBase}-make-m`} name="make" placeholder="Make" className="ctl" />
                <label htmlFor={`${idBase}-model-m`} className="sr-only">
                  Model
                </label>
                <input id={`${idBase}-model-m`} name="model" placeholder="Model" className="ctl" />
              </div>
            )}

            <TextField
              id={`${idBase}-name`}
              label="Name"
              name="name"
              optional
              placeholder={`e.g. "Neil's daily"`}
              className="max-w-none"
              hint="Left blank, the car is named by what it is."
            />

            {state.error && (
              <p role="alert" aria-live="polite" className="field__err">
                {state.error}
              </p>
            )}

            <div className="sheet__actions">
              <Button
                type="submit"
                variant="live"
                className="flex-1"
                loading={pending}
                pendingLabel="Adding…"
                disabled={mode === "picker" && (makeId === null || modelId === null)}
              >
                Add to Garage
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap gap-3">
                {mode !== "picker" && (
                  <button type="button" className="jumplink" onClick={() => setMode("picker")}>
                    Choose the vehicle instead
                  </button>
                )}
                {mode !== "vin" && (
                  <button type="button" className="jumplink" onClick={() => setMode("vin")}>
                    Enter VIN instead
                  </button>
                )}
                {mode !== "manual" ? manualLink : null}
              </span>
              <span className="text-micro text-dim">
                Vehicle data:{" "}
                <a
                  href="https://vehiclesdb.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  VehiclesDB
                </a>{" "}
                · NHTSA
              </span>
            </div>
          </form>
        </div>
      </Dialog>
    </>
  );
}
