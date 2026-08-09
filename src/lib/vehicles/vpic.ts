import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

/**
 * NHTSA vPIC — free, keyless vehicle data (https://vpic.nhtsa.dot.gov/api/).
 * Two jobs here:
 *
 *  1. VIN decode for garage cars: the VIN is the verification input, the
 *     decoded fields are the fitment key (PRD §7.1 — matching never reads
 *     the VIN itself).
 *  2. The make/model taxonomy behind the fitment picker, cached into
 *     vehicle_makes / vehicle_models (0025) so pickers read our own tables
 *     and vPIC is only hit on cache misses, via the service role.
 *
 * vPIC is a government API with real outages; every function here degrades
 * to null/empty rather than throwing, and callers treat that as "decode
 * unavailable", never as "wrong VIN".
 */

const BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";

type VpicResponse<T> = { Count: number; Results: T[] };

async function vpic<T>(path: string, timeoutMs = 8000): Promise<T[] | null> {
  try {
    const res = await fetch(`${BASE}/${path}${path.includes("?") ? "&" : "?"}format=json`, {
      signal: AbortSignal.timeout(timeoutMs),
      // Taxonomy data moves slowly; let Next cache the fetch for a day.
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as VpicResponse<T>;
    return body.Results ?? [];
  } catch (error) {
    reportError("[vpic] request failed", { path, error });
    return null;
  }
}

export type DecodedVin = {
  make: string | null;
  model: string | null;
  year: number | null;
  trim: string | null;
  engine: string | null;
  drivetrain: string | null;
  bodyClass: string | null;
};

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s-])[a-z]/g, (c) => c.toUpperCase());

/** Decodes a VIN. Null = vPIC unreachable or nothing usable came back. */
export async function decodeVin(vin: string): Promise<DecodedVin | null> {
  const rows = await vpic<Record<string, string>>(`DecodeVinValues/${encodeURIComponent(vin)}`);
  const d = rows?.[0];
  if (!d) return null;

  const year = Number(d.ModelYear);
  // vPIC returns a row even for garbage; a decode without make AND year is
  // no decode at all.
  if (!d.Make || !Number.isInteger(year)) return null;

  const displacement = d.DisplacementL ? `${Number(d.DisplacementL).toFixed(1)}L` : null;
  const cylinders = d.EngineCylinders ? `${d.EngineCylinders}cyl` : null;
  const engine =
    [displacement, cylinders, d.FuelTypePrimary || null].filter(Boolean).join(" ") || null;

  return {
    make: titleCase(d.Make),
    model: d.Model || null,
    year,
    trim: d.Trim || d.Series || null,
    engine,
    drivetrain: d.DriveType || null,
    bodyClass: d.BodyClass || null,
  };
}

// ---------- Taxonomy cache ----------

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Passenger-car makes, from our cache; on a cold cache, synced from vPIC
 * (~195 rows) first. Returns [] only when both the cache is empty and vPIC
 * is down — callers fall back to a freetext input.
 */
export async function getVehicleMakes(admin: Admin): Promise<{ id: number; name: string }[]> {
  const { data: cached } = await admin
    .from("vehicle_makes")
    .select("id, name")
    .order("name");
  if (cached?.length) return cached;

  const fetched = await vpic<{ MakeId: number; MakeName: string }>("GetMakesForVehicleType/car");
  if (!fetched?.length) return [];

  const rows = fetched.map((m) => ({ id: m.MakeId, name: titleCase(m.MakeName) }));
  const { error } = await admin
    .from("vehicle_makes")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (error) reportError("[vpic] make cache write failed", { error });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Models for one make, cache-first. A make whose models were never fetched
 * triggers one vPIC round-trip, stamped in models_fetched_at so an empty
 * result isn't re-fetched on every keystroke.
 */
export async function getVehicleModels(admin: Admin, makeName: string): Promise<string[]> {
  const { data: make } = await admin
    .from("vehicle_makes")
    .select("id, name, models_fetched_at")
    .ilike("name", makeName)
    .maybeSingle();
  if (!make) return [];

  if (make.models_fetched_at) {
    const { data: models } = await admin
      .from("vehicle_models")
      .select("name")
      .eq("make_id", make.id)
      .order("name");
    return (models ?? []).map((m) => m.name);
  }

  const fetched = await vpic<{ Model_Name: string }>(
    `GetModelsForMakeYear/make/${encodeURIComponent(make.name)}/vehicletype/car`
  );
  if (fetched === null) return []; // vPIC down — retry next request, no stamp

  const names = [...new Set(fetched.map((m) => m.Model_Name.trim()).filter(Boolean))].sort();
  if (names.length) {
    const { error } = await admin
      .from("vehicle_models")
      .upsert(
        names.map((name) => ({ make_id: make.id, name })),
        { onConflict: "make_id,name", ignoreDuplicates: true }
      );
    if (error) reportError("[vpic] model cache write failed", { make: make.name, error });
  }
  await admin
    .from("vehicle_makes")
    .update({ models_fetched_at: new Date().toISOString() })
    .eq("id", make.id);
  return names;
}
