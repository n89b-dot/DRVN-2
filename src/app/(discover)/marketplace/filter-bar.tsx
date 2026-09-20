"use client";

import { useRef, type ReactNode } from "react";

import { CONDITIONS } from "@/lib/marketplace/taxonomy";
import { Button, FinderRefineSheet, SearchField } from "@/components/ui";
import { refinementCount } from "@/lib/marketplace/state";

import { SortSelect } from "./sort-select";

/**
 * GET-form filter bar with client-side draft cancellation and price validation.
 * Search and Apply submit to the current path with query params.
 *
 * The Marketplace's control hierarchy, top to bottom:
 *
 *   Search   — the query line: find something by text (this plate's top row)
 *   Category — where you are in the taxonomy (CategoryNav / the Browse
 *              sheet — navigation, deliberately not inside this form)
 *   Filters  — narrow the current set: condition · location · price · garage
 *              fit (sheeted behind one "Filters" control at every width)
 *   Sort     — one select in the plate row, every width
 *   Active   — the removable chips under the plate (ActiveFilters)
 *   Results  — the wall
 *
 * Carries `sort` through as a field so choosing a sort and then searching
 * doesn't silently reset it. `page` is deliberately *not* carried: a new
 * search should start at page one.
 */
export function FilterBar({
  action,
  filters,
  showFitToggle,
  fitCarLabel,
  browse,
  brands = [],
}: {
  action: string;
  filters: Record<string, string | undefined>;
  showFitToggle: boolean;
  /** Names the garage car the fit filter refers to, when there's just one. */
  fitCarLabel?: string | null;
  /** The compact-width category browser (CategorySheet), placed in the
   *  toolbar beside Refine and Sort so browsing is one tap on a phone. */
  browse?: ReactNode;
  /** Brands that actually have parts live, with their counts (M-6). */
  brands?: { brand: string; total: number }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const activeCount = refinementCount(filters);

  return (
    <form ref={formRef} action={action} method="get" className="finder" role="search" onSubmit={event => {
      const form = event.currentTarget;
      const min = form.elements.namedItem("min") as HTMLInputElement;
      const max = form.elements.namedItem("max") as HTMLInputElement;
      if (min.value && max.value && Number(min.value) > Number(max.value)) {
        event.preventDefault();
        max.setCustomValidity("Maximum price must be at least the minimum price.");
        max.reportValidity();
      }
    }} onInput={() => {
      const max = formRef.current?.elements.namedItem("max") as HTMLInputElement | null;
      max?.setCustomValidity("");
    }}>
      {["vehicle", "vyear", "ymin", "ymax"].map(key => filters[key] ? <input key={key} type="hidden" name={key} value={filters[key]} /> : null)}
      <div className="finder__main">
        <SearchField label="Search parts" defaultValue={filters.q ?? ""} placeholder="Search…" />

        {/* The dense refinements live one step behind the query line at
            every width (see FinderRefineSheet) — a "Filters" control with a
            live count opens the sheet; the fields stay mounted either way,
            so they always submit with the search. Browse stays compact-only
            (≥640px CategoryNav provides tiles or a category tree); Sort rides in the
            same row so the plate reads Search · Filters · Sort. */}
        <FinderRefineSheet
          /* M-3: a sidebar at ≥1024px, the same fields as a sheet below it. */
          inline="lg"
          activeCount={activeCount}
          onDismiss={() => {
            formRef.current?.reset();
            (formRef.current?.elements.namedItem("max") as HTMLInputElement | null)?.setCustomValidity("");
          }}
          aside={
            <>
              <span className="contents sm:hidden">{browse}</span>
              <SortSelect value={filters.sort} filters={filters} />
            </>
          }
        >
          <span className="microlabel filters__label">Filters</span>
        <select
          name="condition"
          defaultValue={filters.condition ?? ""}
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
        {/* M-3 / M-6. A datalist rather than a select: the brand list grows
            every time somebody lists a part nobody has listed before, so the
            facet suggests what exists without refusing what doesn't. */}
        <input
          name="brand"
          defaultValue={filters.brand ?? ""}
          placeholder="Brand"
          list="marketplace-brands"
          className="ctl w-full max-w-none"
          aria-label="Brand"
        />
        {brands.length > 0 && (
          <datalist id="marketplace-brands">
            {brands.map((b) => (
              <option key={b.brand} value={b.brand}>
                {b.total} for sale
              </option>
            ))}
          </datalist>
        )}
        <input
          name="location"
          defaultValue={filters.location ?? ""}
          placeholder="Seller location (text)"
          className="ctl w-full max-w-none"
          aria-label="Seller location (text)"
        />
        {/* The price bounds are one control in two halves, so they travel
            together — left loose they split across a wrap and read as two
            unrelated fields. */}
        <span className="flex w-full gap-2">
          <input
            name="min"
            type="number"
            min="0"
            step="0.01"
            defaultValue={filters.min ?? ""}
            placeholder="Min $"
            inputMode="decimal"
            className="ctl min-w-0 max-w-none flex-1"
            aria-label="Minimum price"
          />
          <input
            name="max"
            type="number"
            min="0"
            step="0.01"
            defaultValue={filters.max ?? ""}
            placeholder="Max $"
            inputMode="decimal"
            className="ctl min-w-0 max-w-none flex-1"
            aria-label="Maximum price"
          />
        </span>
        {showFitToggle && (
          <label className="flex basis-full items-center gap-2 font-mono text-micro uppercase tracking-[0.1em] text-dim">
            <input
              type="checkbox"
              name="fit"
              value="1"
              defaultChecked={filters.fit === "1"}
              className="sq"
            />
            {fitCarLabel ? `Potential matches for ${fitCarLabel}` : "Potential matches for your current garage"}
          </label>
        )}
          {/* Inside the sheet the refinements apply with the search — say so,
              instead of leaving anyone to guess whether "Done" submits. */}
          <Button type="button" variant="ghost" onClick={() => {
            const form = formRef.current;
            for (const key of ["condition", "brand", "location", "min", "max", "fit", "ymin", "ymax"]) {
              const field = form?.elements.namedItem(key);
              if (field instanceof HTMLInputElement && field.type === "checkbox") field.checked = false;
              else if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = "";
            }
            (form?.elements.namedItem("max") as HTMLInputElement | null)?.setCustomValidity("");
          }}>Reset filters</Button>
          <Button type="submit" className="w-full">
            Apply filters
          </Button>
        </FinderRefineSheet>
      </div>
    </form>
  );
}
