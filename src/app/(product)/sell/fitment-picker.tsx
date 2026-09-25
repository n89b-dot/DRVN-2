"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui";

/** One seller-stated fitment claim, mirrored to listing_fitments (0025). */
export type FitmentRow = {
  make: string;
  model: string;
  year_start: number | null;
  year_end: number | null;
};

export const MAX_FITMENT_ROWS = 10;

/**
 * Structured "what does this fit" rows. The taxonomy (vehicle_makes /
 * vehicle_models via /api/vehicles/models) powers datalist suggestions, but
 * the fields stay free-typing — a canonical name matches the garage exactly,
 * an off-list one still records the claim. Rows serialize into one hidden
 * JSON field the server action validates and mirrors to listing_fitments.
 */
export function FitmentPicker({
  makes,
  initial,
  suggestion,
  onCountChange,
}: {
  makes: string[];
  initial: FitmentRow[];
  /** The selected source car's identity (brief §G): when its make+model isn't
   *  already claimed, a one-tap "+ Fits {car}" chip offers the inference —
   *  passive, never applied without the tap. */
  suggestion?: { make: string; model: string; year: number | null; label: string } | null;
  /** Optional bubble-up of the current valid-row count, for a parent-level
   *  completeness indicator. Fires on mount and whenever rows change. */
  onCountChange?: (count: number) => void;
}) {
  const [rows, setRows] = useState<FitmentRow[]>(initial);
  const [modelsByMake, setModelsByMake] = useState<Map<string, string[]>>(new Map());
  const pending = useRef(new Set<string>());
  const idBase = useId();

  // Fetch model suggestions once per distinct make in play.
  useEffect(() => {
    for (const row of rows) {
      const make = row.make.trim().toLowerCase();
      if (!make || modelsByMake.has(make) || pending.current.has(make)) continue;
      pending.current.add(make);
      fetch(`/api/vehicles/models?make=${encodeURIComponent(row.make.trim())}`)
        .then((res) => (res.ok ? res.json() : { models: [] }))
        .then(({ models }: { models: string[] }) => {
          setModelsByMake((current) => new Map(current).set(make, models));
        })
        .catch(() => {
          // Suggestions are a nicety — typing still works without them.
          pending.current.delete(make);
        });
    }
  }, [rows, modelsByMake]);

  useEffect(() => {
    onCountChange?.(rows.filter((r) => r.make.trim() && r.model.trim()).length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  function update(index: number, patch: Partial<FitmentRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const toYear = (raw: string): number | null => {
    const n = Number(raw);
    return raw && Number.isInteger(n) ? n : null;
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        type="hidden"
        name="fitments"
        value={JSON.stringify(rows.filter((r) => r.make.trim() && r.model.trim()))}
      />
      <datalist id={`${idBase}-makes`}>
        {makes.map((make) => (
          <option key={make} value={make} />
        ))}
      </datalist>

      {rows.map((row, index) => {
        const models = modelsByMake.get(row.make.trim().toLowerCase()) ?? [];
        return (
          <div key={index} className="flex flex-wrap items-end gap-2">
            <label className="field !mb-0 min-w-0 flex-1 basis-[130px]">
              <span className="microlabel">Make</span>
              <input
                value={row.make}
                onChange={(e) => update(index, { make: e.target.value, model: "" })}
                list={`${idBase}-makes`}
                placeholder="Volkswagen"
                maxLength={60}
                className="ctl max-w-none"
                aria-label={`Fitment ${index + 1} make`}
              />
            </label>
            <label className="field !mb-0 min-w-0 flex-1 basis-[150px]">
              <span className="microlabel">Model</span>
              <input
                value={row.model}
                onChange={(e) => update(index, { model: e.target.value })}
                list={`${idBase}-models-${index}`}
                placeholder="Golf R"
                maxLength={80}
                className="ctl max-w-none"
                aria-label={`Fitment ${index + 1} model`}
              />
              <datalist id={`${idBase}-models-${index}`}>
                {models.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>
            <label className="field !mb-0 w-24">
              <span className="microlabel">From</span>
              <input
                value={row.year_start ?? ""}
                onChange={(e) => update(index, { year_start: toYear(e.target.value) })}
                inputMode="numeric"
                placeholder="2022"
                maxLength={4}
                className="ctl max-w-none"
                aria-label={`Fitment ${index + 1} first year`}
              />
            </label>
            <label className="field !mb-0 w-24">
              <span className="microlabel">To</span>
              <input
                value={row.year_end ?? ""}
                onChange={(e) => update(index, { year_end: toYear(e.target.value) })}
                inputMode="numeric"
                placeholder="2025"
                maxLength={4}
                className="ctl max-w-none"
                aria-label={`Fitment ${index + 1} last year`}
              />
            </label>
            <button
              type="button"
              onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
              className="btn btn--ghost"
              aria-label={`Remove fitment ${index + 1}`}
            >
              ✕
            </button>
          </div>
        );
      })}

      {suggestion &&
        rows.length < MAX_FITMENT_ROWS &&
        !rows.some(
          (row) =>
            row.make.trim().toLowerCase() === suggestion.make.trim().toLowerCase() &&
            row.model.trim().toLowerCase() === suggestion.model.trim().toLowerCase(),
        ) && (
          // A suggestion, not a control twin of "Add a vehicle": dashed, and
          // it says it's a suggestion — the identical ghost buttons left it
          // unclear whether the car was already on the list.
          <button
            type="button"
            className="suggestchip self-start"
            onClick={() =>
              setRows((current) => [
                ...current,
                {
                  make: suggestion.make,
                  model: suggestion.model,
                  year_start: suggestion.year,
                  year_end: suggestion.year,
                },
              ])
            }
          >
            <span className="suggestchip__k">Suggested</span>
            Fits {suggestion.label}
            <span className="suggestchip__add" aria-hidden="true">+ Add</span>
          </button>
        )}

      {rows.length < MAX_FITMENT_ROWS && (
        <Button
          variant="ghost"
          className="self-start"
          onClick={() =>
            setRows((current) => [
              ...current,
              // Sensible default: repeat the previous row's make.
              { make: current.at(-1)?.make ?? "", model: "", year_start: null, year_end: null },
            ])
          }
        >
          + Add a vehicle it fits
        </Button>
      )}
      <p className="field__hint !mt-0">
        Years optional — leave blank if it fits every year of that model. Buyers with a matching
        car in their garage see a &quot;fits your car&quot; hint, always labeled seller-stated.
      </p>
    </div>
  );
}
