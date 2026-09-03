import Link from "next/link";

import { ActiveFilterChip } from "@/components/ui";
import type { FeedTab } from "@/lib/feed";
import { exploreSearchHref, type ExploreSearchParams } from "@/lib/explore/search/params";
import { conditionLabel, getCategory } from "@/lib/marketplace/taxonomy";

/**
 * Explore's active-filter readout — the canonical removable-chip pattern
 * (brief §32): one chip per applied refinement, each a link back to the same
 * scope with that dimension dropped, plus "Clear all" back to the clean
 * scope. Works without client JS; announced as "Remove filter: …".
 */
export function ActiveSearchFilters({
  tab,
  params,
  vehicleLabel,
}: {
  tab: FeedTab;
  params: ExploreSearchParams;
  /** Resolved display label for the vehicle param ("Volkswagen Golf R"). */
  vehicleLabel: string | null;
}) {
  const chips: { key: string; href: string; label: string }[] = [];

  if (params.q) {
    chips.push({ key: "q", href: exploreSearchHref(tab, params, { q: "" }), label: `“${params.q}”` });
  }
  if (params.vehicle && vehicleLabel) {
    chips.push({
      key: "vehicle",
      href: exploreSearchHref(tab, params, { vehicle: "" }),
      label: vehicleLabel,
    });
  }
  if (params.ymin || params.ymax) {
    const label =
      params.ymin && params.ymax
        ? `${params.ymin}–${params.ymax}`
        : params.ymin
          ? `${params.ymin} and newer`
          : `${params.ymax} and older`;
    chips.push({
      key: "year",
      href: exploreSearchHref(tab, params, { ymin: "", ymax: "" }),
      label,
    });
  }
  if (params.category) {
    const label = getCategory(params.category)?.label;
    if (label) {
      chips.push({
        key: "category",
        href: exploreSearchHref(tab, params, { category: "" }),
        label,
      });
    }
  }
  if (params.condition) {
    const label = conditionLabel(params.condition);
    if (label) {
      chips.push({
        key: "condition",
        href: exploreSearchHref(tab, params, { condition: "" }),
        label,
      });
    }
  }
  if (params.min || params.max) {
    const label =
      params.min && params.max
        ? `$${params.min}–$${params.max}`
        : params.min
          ? `From $${params.min}`
          : `Up to $${params.max}`;
    chips.push({
      key: "price",
      href: exploreSearchHref(tab, params, { min: "", max: "" }),
      label,
    });
  }
  if (params.fit) {
    chips.push({
      key: "fit",
      href: exploreSearchHref(tab, params, { fit: "" }),
      label: "Fits my garage",
    });
  }

  if (!chips.length) return null;

  return (
    <div className="filterchips" role="group" aria-label="Active filters">
      <span className="microlabel filters__label">Filtered by</span>
      {chips.map((chip) => (
        <ActiveFilterChip key={chip.key} href={chip.href} label={`Remove filter: ${chip.label}`}>
          {chip.label}
        </ActiveFilterChip>
      ))}
      <Link href={tab === "all" ? "/explore" : `/explore?tab=${tab}`} className="jumplink">
        Clear all
      </Link>
    </div>
  );
}
