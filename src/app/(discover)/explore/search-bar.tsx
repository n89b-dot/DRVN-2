import { Button, FinderRefineSheet, SuggestingSearchField } from "@/components/ui";
import type { FeedTab } from "@/lib/feed";
import {
  activeFilterCount,
  hasActiveSearch,
  type ExploreSearchParams,
} from "@/lib/explore/search/params";
import { CATEGORIES, CONDITIONS } from "@/lib/marketplace/taxonomy";
import type { VehicleFilterSelection } from "@/lib/vehicles/catalog";

import { SearchSortSelect } from "./search-sort-select";
import { VehicleFilterField } from "./vehicle-filter-field";

/**
 * Explore's search command plate (brief §7/§13) — the `.finder` GET form
 * under the page head, one row at every width: query line with grouped
 * autocomplete (Enter submits — no separate button) · Filters (sheeted at
 * all widths, with a live count) · Sort. Every search is a URL; the refinements a scope shows are
 * exactly ALLOWED_FILTER_KEYS for that scope, so the form can never submit
 * a filter the parser would drop.
 *
 * Control hierarchy mirrors the marketplace's finder; the removable chips
 * (ActiveSearchFilters) sit under the plate.
 */
export function ExploreSearchBar({
  tab,
  params,
  vehicle,
  showFitToggle,
}: {
  tab: FeedTab;
  params: ExploreSearchParams;
  /** The URL's vehicle selection, resolved server-side (labels included). */
  vehicle: VehicleFilterSelection | null;
  showFitToggle: boolean;
}) {
  const isParts = tab === "parts";

  return (
    <form action="/explore" method="get" className="finder" role="search">
      {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
      <div className="finder__main">
        <SuggestingSearchField
          label="Search DRVN"
          defaultValue={params.q}
          placeholder="Search…"
          endpoint="/api/explore/suggest"
        />

        <FinderRefineSheet
          activeCount={activeFilterCount(params)}
          aside={
            <SearchSortSelect
              scope={tab}
              value={params.sort}
              hasQuery={Boolean(params.q)}
              searchActive={hasActiveSearch(params)}
            />
          }
        >
          <span className="microlabel filters__label">Filters</span>

          <VehicleFilterField
            initial={
              vehicle
                ? {
                    makeId: vehicle.makeId,
                    modelId: vehicle.modelId,
                    make: vehicle.make,
                    model: vehicle.model,
                  }
                : null
            }
          />

          {/* Year rides every scope — the car's model year throughout (the
              owning car for updates, the source car for parts). */}
          <span className="flex w-full gap-2">
            <input
              name="ymin"
              defaultValue={params.ymin}
              placeholder="Year from"
              inputMode="numeric"
              maxLength={4}
              className="ctl min-w-0 max-w-none flex-1"
              aria-label="Model year from"
            />
            <input
              name="ymax"
              defaultValue={params.ymax}
              placeholder="Year to"
              inputMode="numeric"
              maxLength={4}
              className="ctl min-w-0 max-w-none flex-1"
              aria-label="Model year to"
            />
          </span>

          {isParts && (
            <>
              <select
                name="category"
                defaultValue={params.category}
                className="ctl w-full max-w-none"
                aria-label="Category"
              >
                <option value="">Any category</option>
                {CATEGORIES.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                name="condition"
                defaultValue={params.condition}
                className="ctl w-full max-w-none"
                aria-label="Condition"
              >
                <option value="">Any condition</option>
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              {/* The price bounds are one control in two halves, so they travel
                  together — left loose they split across a wrap. */}
              <span className="flex w-full gap-2">
                <input
                  name="min"
                  defaultValue={params.min}
                  placeholder="Min $"
                  inputMode="decimal"
                  className="ctl min-w-0 max-w-none flex-1"
                  aria-label="Minimum price"
                />
                <input
                  name="max"
                  defaultValue={params.max}
                  placeholder="Max $"
                  inputMode="decimal"
                  className="ctl min-w-0 max-w-none flex-1"
                  aria-label="Maximum price"
                />
              </span>
            </>
          )}

          {isParts && showFitToggle && (
            <label className="flex basis-full items-center gap-2 font-mono text-micro uppercase tracking-[0.1em] text-dim">
              <input
                type="checkbox"
                name="fit"
                value="1"
                defaultChecked={params.fit}
                className="sq"
              />
              Fits my garage
            </label>
          )}

          {/* Inside the sheet the refinements apply with the search — say so,
              instead of leaving anyone to guess whether "Done" submits. */}
          <Button type="submit" className="w-full">
            Apply filters
          </Button>
        </FinderRefineSheet>
      </div>
    </form>
  );
}
