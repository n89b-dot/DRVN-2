"use client";

/**
 * Sort control for Explore search — scope-aware options (brief §19):
 * Relevance/Newest while a text query is active on All/Builds/Updates,
 * the marketplace's Newest/Price set on Parts. Deliberately small; no
 * invented popularity scores. Choosing submits the surrounding GET form
 * immediately, same idiom as the marketplace's SortSelect.
 */
export function SearchSortSelect({
  scope,
  value,
  hasQuery,
  searchActive,
}: {
  scope: "all" | "cars" | "updates" | "parts";
  value?: string;
  hasQuery: boolean;
  /** Any query or refinement on — browse mode keeps the feed's own order. */
  searchActive: boolean;
}) {
  // Browse mode has no sort (the feed is the feed), and without a query
  // there's no relevance to rank by — a one-option select is furniture.
  if (!searchActive) return null;
  if (scope !== "parts" && !hasQuery) return null;

  return (
    <select
      name="sort"
      defaultValue={value ?? ""}
      className="ctl !w-auto"
      aria-label="Sort results"
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      {scope === "parts" ? (
        <>
          <option value="">Newest</option>
          <option value="price_asc">Price ↑</option>
          <option value="price_desc">Price ↓</option>
        </>
      ) : (
        <>
          <option value="">Relevance</option>
          <option value="newest">Newest</option>
        </>
      )}
    </select>
  );
}
