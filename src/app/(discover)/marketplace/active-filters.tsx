import Link from "next/link";

import { conditionLabel } from "@/lib/marketplace/taxonomy";

type Filters = Record<string, string | undefined>;

function href(basePath: string, filters: Filters, remove: string[]) {
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
}: {
  basePath: string;
  filters: Filters;
  fitCarLabel?: string | null;
}) {
  const chips: { keys: string[]; label: string }[] = [];

  if (filters.q) chips.push({ keys: ["q"], label: `“${filters.q}”` });
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
  if (filters.location) chips.push({ keys: ["location"], label: filters.location });
  if (filters.fit === "1") {
    chips.push({
      keys: ["fit"],
      label: fitCarLabel ? `Fits ${fitCarLabel}` : "Fits your garage",
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
          {chip.label}
          <span aria-hidden="true">×</span>
        </Link>
      ))}
      <Link href={basePath} className="jumplink">
        Clear all
      </Link>
    </div>
  );
}
