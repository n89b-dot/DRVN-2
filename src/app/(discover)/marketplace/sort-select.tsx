"use client";

/**
 * Compact sort control for the discovery toolbar.
 *
 * On compact screens this is the visible Sort control, sitting beside Refine
 * in the finder's toolbar row; ≥640px the row is display:none but the select
 * still belongs to the GET form, so it carries the current sort through a
 * desktop search exactly like the hidden `sort` field it replaces.
 *
 * Choosing a sort submits the form immediately — the toolbar answers the
 * question in one tap, no separate Apply step.
 */
export function SortSelect({ value }: { value?: string }) {
  return (
    <select
      name="sort"
      defaultValue={value ?? ""}
      className="ctl !w-auto"
      aria-label="Sort results"
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      {/* Short labels on purpose: a native select sizes to its longest
          option, and "Price: low to high" pushed the control wide enough to
          wrap the compact toolbar at 375px. Same glyphs as the desktop sort
          chips. */}
      <option value="">Newest</option>
      <option value="price_asc">Price ↑</option>
      <option value="price_desc">Price ↓</option>
    </select>
  );
}
