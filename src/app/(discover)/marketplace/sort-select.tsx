"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { marketplaceHref, type ListingFilters } from "@/lib/marketplace/state";

/**
 * Compact sort control for the discovery toolbar.
 *
 * One visible control at every width. Sorting navigates from applied URL
 * state, so unsaved filter drafts cannot leak into the request. Its named
 * field also carries the selected sort through subsequent searches.
 */
export function SortSelect({ value, filters }: { value?: string; filters: ListingFilters }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <>
    <select
      name="sort"
      value={value ?? "newest"}
      className="ctl !w-auto"
      aria-label="Sort results"
      aria-busy={pending}
      data-marketplace-pending={pending}
      onChange={(event) => { const sort = event.currentTarget.value; startTransition(() => router.push(marketplaceHref(filters, { sort, page: undefined }))); }}
    >
      {/* Short labels on purpose: a native select sizes to its longest
          option, and "Price: low to high" pushed the control wide enough to
          wrap the compact toolbar at 375px. */}
      <option value="newest">Newest</option>
      <option value="price_asc">Item price ↑</option>
      <option value="price_desc">Item price ↓</option>
    </select>
    {pending && <span role="status" className="sr-only">Updating parts…</span>}
    </>
  );
}
