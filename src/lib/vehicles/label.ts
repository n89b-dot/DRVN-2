/**
 * The one way DRVN names a vehicle in running text — "2019 Volkswagen Golf R",
 * "BMW M3", "911 GT3".
 *
 * Year, make, model and (optionally) trim are joined with single spaces and
 * nothing else is touched: the casing a keeper or the vPIC decoder gave us is
 * the casing that renders. Automotive names are full of legitimate caps and
 * digits — BMW, VW, GTI, RS3, GR Corolla — so a "helpful" title-case or
 * lowercase pass would get more of them wrong than right. Callers that want
 * a visual treatment use the `.vref` text style, which deliberately carries no
 * `text-transform` for the same reason.
 *
 * Replaces eight copies of `[year, make, model].filter(Boolean).join(" ")`.
 */
export type VehicleParts = {
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
};

function clean(part: number | string | null | undefined): string {
  if (part === null || part === undefined) return "";
  const text = String(part).trim();
  // A 0 year is a placeholder, not a model year.
  if (typeof part === "number" && part === 0) return "";
  return text;
}

/** "2019 Volkswagen Golf R" — empty string when nothing is known. */
export function vehicleLabel(v: VehicleParts | null | undefined): string {
  if (!v) return "";
  return [clean(v.year), clean(v.make), clean(v.model), clean(v.trim)].filter(Boolean).join(" ");
}

/** Make + model only — the platform a part fits, year-agnostic. */
export function platformLabel(v: Pick<VehicleParts, "make" | "model"> | null | undefined): string {
  if (!v) return "";
  return [clean(v.make), clean(v.model)].filter(Boolean).join(" ");
}

/**
 * The provenance line under a part — the source car's name, nothing more
 * ("2019 Volkswagen Golf R"). The card's position under the price already
 * says "came off"; a prefix only cost characters on a phone cell. Returns
 * null when there's no source car, so callers render nothing.
 */
export function provenanceLine(carLabel: string | null | undefined): string | null {
  const label = (carLabel ?? "").trim();
  return label || null;
}
