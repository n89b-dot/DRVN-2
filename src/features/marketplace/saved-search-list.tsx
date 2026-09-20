"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { readSavedSearch } from "@/lib/marketplace/saved-search";
import { marketplaceHref } from "@/lib/marketplace/state";
import type { SavedSearch } from "@/lib/database.types";

import { deleteSavedSearch, setSavedSearchAlert } from "./saved-search-actions";

/**
 * Saved searches on /saved (brief §C): each row is the kept marketplace
 * state — open it, opt in/out of alerts, or delete it. The alert toggle is
 * the ONLY place alerting turns on; nothing opts a user in for them.
 */

function describe(params: Record<string, string>): string {
  const bits: string[] = [];
  if (params.condition) bits.push(params.condition.replace("_", " "));
  if (params.min || params.max) bits.push(`$${params.min ?? "0"}–${params.max ? `$${params.max}` : "any"}`);
  if (params.brand) bits.push(params.brand);
  if (params.location) bits.push(params.location);
  if (params.fit === "1") bits.push("Potential matches for my current garage");
  if (params.vehicle) bits.push(`Vehicle selected${params.vyear ? ` · ${params.vyear}` : ""}`);
  if (params.sort) bits.push(params.sort === "price_asc" ? "Item price: low to high" : params.sort === "price_desc" ? "Item price: high to low" : "Newest");
  return bits.join(" · ");
}

export function SavedSearchList({ searches }: { searches: SavedSearch[] }) {
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState(searches);
  const [error, setError] = useState<string | null>(null);

  if (local.length === 0) return null;

  return (
    <div className="rowlist">
      {error && <p role="alert" className="field__err">{error}</p>}
      {local.map((search) => (
        <div key={search.id} className="jobrow flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="min-w-0 flex-1">
            {readSavedSearch(search.params) ? <Link
              href={marketplaceHref(readSavedSearch(search.params)!)}
              className="order__name block truncate transition-colors hover:text-live"
            >
              {search.name}
            </Link> : <span className="order__name">{search.name}</span>}
            <span className="order__meta block">
              {readSavedSearch(search.params) ? describe(search.params) || "all listings" : "This search uses a newer format. Recreate it before enabling alerts."}
            </span>
          </span>
          <label className="flex cursor-pointer items-center gap-2 text-micro">
            <input
              type="checkbox"
              checked={search.alert}
              disabled={pending || !readSavedSearch(search.params)}
              onChange={(event) => {
                const alert = event.target.checked;
                setError(null);
                const fd = new FormData();
                fd.set("id", search.id);
                if (alert) fd.set("alert", "on");
                startTransition(async () => {
                  try {
                    const result = await setSavedSearchAlert(fd);
                    if (result.error) setError(result.error);
                    else setLocal(rows => rows.map(row => row.id === search.id ? { ...row, alert } : row));
                  } catch { setError("Couldn't update alerts. Try again."); }
                });
              }}
            />
            Alert me
          </label>
          <form
            action={(fd) => {
              setError(null);
              startTransition(async () => {
                try {
                  const result = await deleteSavedSearch(fd);
                  if (result.error) setError(result.error);
                  else setLocal(rows => rows.filter(row => row.id !== search.id));
                } catch { setError("Couldn't delete the search. Try again."); }
              });
            }}
          >
            <input type="hidden" name="id" value={search.id} />
            <button type="submit" disabled={pending} className="jumplink" aria-label={`Delete saved search ${search.name}`}>
              Delete
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}
