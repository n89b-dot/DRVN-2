"use client";

import { useRef, useState } from "react";
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
  const formRef = useRef<HTMLFormElement>(null);
  const [vehicleDraft, setVehicleDraft] = useState(0);
  const isParts = tab === "parts";

  return (
    <form ref={formRef} action="/explore" method="get" className="finder" role="search" onSubmit={event => {
      const min = event.currentTarget.elements.namedItem("min") as HTMLInputElement | null;
      const max = event.currentTarget.elements.namedItem("max") as HTMLInputElement | null;
      if (min?.value && max?.value && Number(min.value) > Number(max.value)) {
        event.preventDefault(); max.setCustomValidity("Maximum price must be at least the minimum price."); max.reportValidity();
      }
    }} onInput={() => (formRef.current?.elements.namedItem("max") as HTMLInputElement | null)?.setCustomValidity("")}>
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
          onDismiss={() => { formRef.current?.reset(); (formRef.current?.elements.namedItem("max") as HTMLInputElement | null)?.setCustomValidity(""); setVehicleDraft(value => value + 1); }}
          aside={
            <SearchSortSelect
              scope={tab}
              params={params}
              value={params.sort}
              hasQuery={Boolean(params.q)}
              searchActive={hasActiveSearch(params)}
            />
          }
        >
          <span className="microlabel filters__label">Filters</span>

          <VehicleFilterField key={vehicleDraft}
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
              placeholder={isParts ? "Source year from" : "Year from"}
              inputMode="numeric"
              maxLength={4}
              className="ctl min-w-0 max-w-none flex-1"
              aria-label={isParts ? "Source-car year from" : "Model year from"}
            />
            <input
              name="ymax"
              defaultValue={params.ymax}
              placeholder={isParts ? "Source year to" : "Year to"}
              inputMode="numeric"
              maxLength={4}
              className="ctl min-w-0 max-w-none flex-1"
              aria-label={isParts ? "Source-car year to" : "Model year to"}
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
                  type="number" min="0" step="0.01"
                  defaultValue={params.min}
                  placeholder="Min $"
                  inputMode="decimal"
                  className="ctl min-w-0 max-w-none flex-1"
                  aria-label="Minimum price"
                />
                <input
                  name="max"
                  type="number" min="0" step="0.01"
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
              Potential matches for my current garage
            </label>
          )}

          {/* Inside the sheet the refinements apply with the search — say so,
              instead of leaving anyone to guess whether "Done" submits. */}
          <Button type="submit" className="w-full">
            Apply filters
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => {
            for (const name of ["condition", "min", "max", "fit", "ymin", "ymax"]) {
              const input = formRef.current?.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
              if (!input) continue;
              if (input instanceof HTMLInputElement && input.type === "checkbox") input.checked = false;
              else input.value = "";
              input.setCustomValidity("");
            }
          }}>Reset filters</Button>
        </FinderRefineSheet>
      </div>
    </form>
  );
}
