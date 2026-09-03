import "server-only";

import type { CatalogMake, CatalogModel } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The DRVN-owned vehicle catalog (0041) — reads for the Add Car picker.
 * Ranking rule everywhere: known popularity first (decile 1 = most common),
 * unknown after, alphabetical inside a band — so a US/EU user sees Volkswagen
 * before Wiesmann without any per-user machinery.
 *
 * Sources behind the rows: the vPIC cache seed (0041) and the VehiclesDB
 * import (scripts/import-vehiclesdb.mjs, CC-BY 4.0 — attribution in
 * docs/site/vehicles.md). Display strings on cars stay frozen snapshots.
 */

export type CatalogMakeOption = Pick<CatalogMake, "id" | "name" | "popularity_decile">;
export type CatalogModelOption = Pick<CatalogModel, "id" | "name" | "aliases" | "popularity_decile">;

export async function getCatalogMakes(): Promise<CatalogMakeOption[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("catalog_makes")
    .select("id, name, popularity_decile")
    .order("popularity_decile", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
    .limit(1000);
  return data ?? [];
}

export async function getCatalogModels(makeId: number): Promise<CatalogModelOption[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("catalog_models")
    .select("id, name, aliases, popularity_decile")
    .eq("make_id", makeId)
    .order("popularity_decile", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
    .limit(2000);
  return data ?? [];
}

/**
 * Case-insensitive catalog match for typed words (VIN decodes, manual entry) —
 * quiet automation: when the strings name a catalog vehicle, the references
 * come along free; when they don't, nulls are the right answer.
 */
export async function matchCatalogByName(
  make: string,
  model: string | null,
): Promise<{ makeId: number | null; modelId: number | null }> {
  // ilike with wildcards escaped = case-insensitive exact match.
  const exact = (value: string) =>
    value.trim().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const admin = createAdminClient();
  const { data: makeRow } = await admin
    .from("catalog_makes")
    .select("id")
    .ilike("name", exact(make))
    .maybeSingle();
  if (!makeRow) return { makeId: null, modelId: null };
  if (!model?.trim()) return { makeId: makeRow.id, modelId: null };
  const { data: modelRow } = await admin
    .from("catalog_models")
    .select("id")
    .eq("make_id", makeRow.id)
    .ilike("name", exact(model))
    .maybeSingle();
  return { makeId: makeRow.id, modelId: modelRow?.id ?? null };
}

export type VehicleFilterSelection = {
  makeId: number;
  modelId: number | null;
  make: string;
  model: string | null;
  /** Display form — "Volkswagen Golf R" / "Volkswagen". */
  label: string;
};

/**
 * Resolve a `vehicle` URL param ("<makeId>" or "<makeId>-<modelId>") into
 * canonical catalog identity — the shared vocabulary for vehicle filtering on
 * Explore search and marketplace listings (brief §17). Returns null for
 * anything that doesn't name real catalog rows, so a mangled URL degrades to
 * "no vehicle filter" rather than an error.
 */
export async function resolveVehicleFilter(
  param: string | null | undefined,
): Promise<VehicleFilterSelection | null> {
  if (!param || !/^\d{1,10}(-\d{1,10})?$/.test(param)) return null;
  const [makeStr, modelStr] = param.split("-");
  const makeId = Number(makeStr);
  const modelId = modelStr ? Number(modelStr) : null;
  const admin = createAdminClient();
  const [{ data: make }, { data: model }] = await Promise.all([
    admin.from("catalog_makes").select("id, name").eq("id", makeId).maybeSingle(),
    modelId
      ? admin.from("catalog_models").select("id, make_id, name").eq("id", modelId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!make) return null;
  if (modelId && (!model || model.make_id !== make.id)) return null;
  return {
    makeId: make.id,
    modelId: model?.id ?? null,
    make: make.name,
    model: model?.name ?? null,
    label: model ? `${make.name} ${model.name}` : make.name,
  };
}

/** Resolve one make + model pair by id, for validating a picker submission. */
export async function resolveCatalogSelection(
  makeId: number,
  modelId: number,
): Promise<{ make: string; model: string } | null> {
  const admin = createAdminClient();
  const [{ data: make }, { data: model }] = await Promise.all([
    admin.from("catalog_makes").select("id, name").eq("id", makeId).maybeSingle(),
    admin.from("catalog_models").select("id, make_id, name").eq("id", modelId).maybeSingle(),
  ]);
  if (!make || !model || model.make_id !== make.id) return null;
  return { make: make.name, model: model.name };
}
