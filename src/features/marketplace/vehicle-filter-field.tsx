"use client";

import { useEffect, useState } from "react";

import { Button, ComboField, type ComboOption } from "@/components/ui";

/**
 * The Vehicle refinement (brief §17): two ComboFields over the canonical
 * catalog (0041) — the same ranked lists, aliases and APIs as Add Car — that
 * ride along in the search GET form as one hidden `vehicle` param
 * ("<makeId>" or "<makeId>-<modelId>"). Make alone is a valid filter; the
 * model combo stays disabled until a make is chosen. Nothing here submits by
 * itself — the surrounding form's Search/Apply does.
 */

type CatalogMake = { id: number; name: string };
type CatalogModel = { id: number; name: string; aliases?: string[] };

export function VehicleFilterField({
  initial,
}: {
  /** The URL's current selection, resolved server-side so labels render
   *  before any catalog fetch lands. */
  initial: { makeId: number; modelId: number | null; make: string; model: string | null } | null;
}) {
  const [makes, setMakes] = useState<ComboOption[]>(
    initial ? [{ id: initial.makeId, label: initial.make }] : []
  );
  const [models, setModels] = useState<ComboOption[]>(
    initial?.modelId && initial.model ? [{ id: initial.modelId, label: initial.model }] : []
  );
  const [makeId, setMakeId] = useState<number | null>(initial?.makeId ?? null);
  const [modelId, setModelId] = useState<number | null>(initial?.modelId ?? null);
  const [makesLoaded, setMakesLoaded] = useState(false);
  // Which make the current `models` list belongs to — doubles as the loading
  // signal (a chosen make whose list hasn't landed yet is "loading").
  const [modelsFor, setModelsFor] = useState<number | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (makesLoaded) return;
    let cancelled = false;
    fetch("/api/vehicles/catalog/makes")
      .then((res) => { if (!res.ok) throw new Error("catalog"); return res.json(); })
      .then((body: { makes?: CatalogMake[] }) => {
        if (cancelled) return;
        const options = (body.makes ?? []).map((m) => ({ id: m.id, label: m.name }));
        if (options.length) setMakes(options);
        setMakesLoaded(true);
      })
      .catch(() => { if (!cancelled) setCatalogError("Vehicle makes couldn’t be loaded."); });
    return () => {
      cancelled = true;
    };
  }, [makesLoaded, retry]);

  useEffect(() => {
    if (!makeId || modelsFor === makeId) return;
    let cancelled = false;
    fetch(`/api/vehicles/catalog/models?make=${makeId}`)
      .then((res) => { if (!res.ok) throw new Error("catalog"); return res.json(); })
      .then((body: { models?: CatalogModel[] }) => {
        if (cancelled) return;
        setModels(
          (body.models ?? []).map((m) => ({ id: m.id, label: m.name, keywords: m.aliases }))
        );
        setModelsFor(makeId);
      })
      .catch(() => { if (!cancelled) setCatalogError("Vehicle models couldn’t be loaded."); });
    return () => {
      cancelled = true;
    };
  }, [makeId, modelsFor, retry]);

  const loadingMakes = !makesLoaded && !catalogError;
  const loadingModels = Boolean(makeId) && modelsFor !== makeId && !catalogError;

  const vehicleValue = makeId ? (modelId ? `${makeId}-${modelId}` : String(makeId)) : "";

  return (
    <span className="grid w-full gap-3 sm:grid-cols-2">
      <input type="hidden" name="vehicle" value={vehicleValue} disabled={!vehicleValue} />
      <ComboField
        id="catalog-vehicle-make"
        label="Make"
        options={makes}
        value={makeId}
        loading={loadingMakes}
        placeholder="Any make"
        optional
        onChange={(option) => {
          const next = option ? Number(option.id) : null;
          setMakeId(next);
          setModelId(null);
          setModels([]);
          setModelsFor(null);
          setCatalogError(null);
        }}
        className="w-full max-w-none"
      />
      {catalogError && <span className="sm:col-span-2"><span role="alert" className="field__err">{catalogError}</span><Button variant="ghost" type="button" onClick={() => { setCatalogError(null); setRetry(value => value + 1); }}>Retry vehicle list</Button></span>}
      <ComboField
        id="catalog-vehicle-model"
        label="Model"
        options={models}
        value={modelId}
        loading={loadingModels}
        disabled={!makeId}
        placeholder={makeId ? "Any model" : "Pick a make first"}
        optional
        onChange={(option) => setModelId(option ? Number(option.id) : null)}
        className="w-full max-w-none"
      />
    </span>
  );
}
