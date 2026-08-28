"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import type { SavedSearch } from "@/lib/database.types";

import { deleteSavedSearch, setSavedSearchAlert } from "./saved-search-actions";

/**
 * Saved searches on /saved (brief §C): each row is the kept marketplace
 * state — open it, opt in/out of alerts, or delete it. The alert toggle is
 * the ONLY place alerting turns on; nothing opts a user in for them.
 */

function marketplaceHref(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `/marketplace?${qs}` : "/marketplace";
}

function describe(params: Record<string, string>): string {
  const bits: string[] = [];
  if (params.condition) bits.push(params.condition.replace("_", " "));
  if (params.min || params.max) bits.push(`$${params.min ?? "0"}–${params.max ? `$${params.max}` : "any"}`);
  if (params.location) bits.push(params.location);
  if (params.fit === "1") bits.push("fits my garage");
  return bits.join(" · ");
}

export function SavedSearchList({ searches }: { searches: SavedSearch[] }) {
  const [, startTransition] = useTransition();
  const [local, setLocal] = useState(searches);

  if (local.length === 0) return null;

  return (
    <div className="rowlist">
      {local.map((search) => (
        <div key={search.id} className="jobrow flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="min-w-0 flex-1">
            <Link
              href={marketplaceHref(search.params)}
              className="order__name block truncate transition-colors hover:text-live"
            >
              {search.name}
            </Link>
            <span className="order__meta block">
              {describe(search.params) || "all listings"}
            </span>
          </span>
          <label className="flex cursor-pointer items-center gap-2 text-micro">
            <input
              type="checkbox"
              checked={search.alert}
              onChange={(event) => {
                const alert = event.target.checked;
                setLocal((rows) =>
                  rows.map((row) => (row.id === search.id ? { ...row, alert } : row)),
                );
                const fd = new FormData();
                fd.set("id", search.id);
                if (alert) fd.set("alert", "on");
                startTransition(() => {
                  void setSavedSearchAlert(fd);
                });
              }}
            />
            Alert me
          </label>
          <form
            action={(fd) => {
              setLocal((rows) => rows.filter((row) => row.id !== search.id));
              startTransition(() => {
                void deleteSavedSearch(fd);
              });
            }}
          >
            <input type="hidden" name="id" value={search.id} />
            <button type="submit" className="jumplink" aria-label={`Delete saved search ${search.name}`}>
              Delete
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}
