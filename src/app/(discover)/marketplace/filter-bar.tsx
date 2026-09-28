"use client";

import { useRef, type ReactNode } from "react";

import { CONDITIONS } from "@/lib/marketplace/taxonomy";
import { Button, Checkbox, FinderRefineSheet, FormField, SearchField, Select, TextField } from "@/components/ui";
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
  sidebar,
  brands = [],
  conditions,
}: {
  action: string;
  filters: Record<string, string | undefined>;
  showFitToggle: boolean;
  /** Names the garage car the fit filter refers to, when there's just one. */
  fitCarLabel?: string | null;
  /** The compact-width category browser (CategorySheet), placed in the
   *  toolbar beside Refine and Sort so browsing is one tap on a phone. */
  browse?: ReactNode;
  /** The category list, shown at the top of the panel only where the panel
   *  is a sidebar (≥1024px). In the sheet, categories have their own sheet. */
  sidebar?: ReactNode;
  /** Brands that actually have parts live, with their counts (M-6). */
  brands?: { brand: string; total: number }[];
  /** Conditions that have parts listed; the others aren't offered (the
   *  selected one always is). Undefined when unknown: offer them all. */
  conditions?: readonly string[];
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
          /* One footer row: Reset quiet on the left, Apply on the right. */
          actions={
            <>
              <Button type="button" variant="quiet" onClick={() => {
                const form = formRef.current;
                for (const key of ["condition", "brand", "location", "min", "max", "fit", "ymin", "ymax"]) {
                  const field = form?.elements.namedItem(key);
                  if (field instanceof HTMLInputElement && field.type === "checkbox") field.checked = false;
                  else if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = "";
                }
                (form?.elements.namedItem("max") as HTMLInputElement | null)?.setCustomValidity("");
              }}>Reset</Button>
              <Button type="submit">Apply filters</Button>
            </>
          }
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
          {sidebar && <div className="hidden lg:block">{sidebar}</div>}
          <span className="microlabel filters__label">Filters</span>
          {/* Labelled fields: a placeholder that is the only label vanishes
              the moment you type, and "Seller location (te…" truncated. */}
          <Select id="mkt-condition" label="Condition" name="condition" defaultValue={filters.condition ?? ""} className="w-full max-w-none" fieldClassName="!mb-0">
            <option value="">Any condition</option>
            {CONDITIONS.filter((c) => !conditions || conditions.includes(c.value) || c.value === filters.condition).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          {/* M-3 / M-6. A datalist rather than a select: the brand list grows
              every time somebody lists a part nobody has listed before, so the
              facet suggests what exists without refusing what doesn't. */}
          <TextField
            id="mkt-brand"
            label="Brand"
            name="brand"
            defaultValue={filters.brand ?? ""}
            placeholder="Any brand"
            list="marketplace-brands"
            className="w-full max-w-none"
            fieldClassName="!mb-0"
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
          <TextField
            id="mkt-location"
            label="Ships from"
            name="location"
            defaultValue={filters.location ?? ""}
            placeholder="City, region or country"
            className="w-full max-w-none"
            fieldClassName="!mb-0"
          />
          {/* The price bounds are one control in two halves, so they travel
              together — left loose they split across a wrap and read as two
              unrelated fields. */}
          <FormField id="mkt-min" label="Price" className="!mb-0">
            <span className="flex w-full gap-2">
              <input
                id="mkt-min"
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
          </FormField>
          {showFitToggle && (
            <Checkbox
              name="fit"
              value="1"
              defaultChecked={filters.fit === "1"}
              label={fitCarLabel ? `Potential matches for ${fitCarLabel}` : "Potential matches for my garage"}
            />
          )}
        </FinderRefineSheet>
      </div>
    </form>
  );
}
