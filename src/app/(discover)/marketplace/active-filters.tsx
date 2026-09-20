import Link from "next/link";

import { conditionLabel } from "@/lib/marketplace/taxonomy";
import { clearRefinements, marketplaceHref, refinementCount } from "@/lib/marketplace/state";

type Filters = Record<string, string | undefined>;

function href(basePath: string, filters: Filters, remove: string[]) {
  if (basePath.startsWith("/marketplace")) {
    return marketplaceHref(filters, Object.fromEntries([...remove, "page"].map(key => [key, undefined])));
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (!value || remove.includes(key) || key === "page") continue;
    search.set(key, value);
  }
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * Active-filter readout — one removable chip per applied filter, plus
 * "Clear all". Renders nothing when no filters are on, so the browse
 * state stays clean. Each chip is a link back to the same path with that
 * one filter dropped (and `page` reset), so it works without client JS
 * and is announced as "Remove filter: …" to screen readers.
 */
export function ActiveFilters({
  basePath,
  filters,
  fitCarLabel,
  vehicleLabel,
}: {
  basePath: string;
  filters: Filters;
  fitCarLabel?: string | null;
  vehicleLabel?: string | null;
}) {
  const chips: { keys: string[]; label: string }[] = [];

  if (filters.q) chips.push({ keys: ["q"], label: `“${filters.q}”` });
  if (filters.vehicle) chips.push({ keys: ["vehicle"], label: vehicleLabel ?? "Selected vehicle" });
  if (filters.ymin || filters.ymax) chips.push({ keys: ["ymin", "ymax"], label: `Source-car year: ${filters.ymin ?? "Any"}–${filters.ymax ?? "Any"}` });
  if (filters.condition) {
    const label = conditionLabel(filters.condition);
    if (label) chips.push({ keys: ["condition"], label });
  }
  if (filters.min || filters.max) {
    const label =
      filters.min && filters.max
        ? `$${filters.min}–$${filters.max}`
        : filters.min
          ? `From $${filters.min}`
          : `Up to $${filters.max}`;
    chips.push({ keys: ["min", "max"], label });
  }
  // M-6: a filter that is counted on the Filters control has to be
  // removable where the others are, or "Filters 1" points at nothing.
  if (filters.brand) chips.push({ keys: ["brand"], label: `Brand: ${filters.brand}` });
  if (filters.location) chips.push({ keys: ["location"], label: filters.location });
  if (filters.fit === "1") {
    chips.push({
      keys: ["fit"],
      label: fitCarLabel ? `Potential matches for ${fitCarLabel}` : "Potential garage matches",
    });
  }

  if (!chips.length) return null;

  return (
    <div className="filterchips" role="group" aria-label="Active filters">
      <span className="microlabel filters__label">Filtered by</span>
      {chips.map((chip) => (
        <Link
          key={chip.keys.join("-")}
          href={href(basePath, filters, chip.keys)}
          className="chip chip--x"
          aria-label={`Remove filter: ${chip.label}`}
        >
          <span className="marketplace-filter-label">{chip.label}</span>
          <span aria-hidden="true">×</span>
        </Link>
      ))}
      {refinementCount(filters) > 0 && <Link href={marketplaceHref(clearRefinements(filters))} className="jumplink">Clear filters</Link>}
    </div>
  );
}
