"use client";

import { useActionState } from "react";

import { Toast } from "@/components/ui";

import { createSavedSearch, type SavedSearchState } from "./saved-search-actions";

/**
 * The quiet `Save search` action (brief §C): appears only when the shopper
 * has actually built a state worth keeping, saves silently, and answers with
 * one toast. It never prompts, never opens a modal, and alerting is a
 * separate decision made later in Saved.
 */
export function SaveSearchButton({
  params,
  signedIn,
}: {
  /** The current marketplace filter state (q, category, min…), empties omitted. */
  params: Record<string, string>;
  signedIn: boolean;
}) {
  const [state, action, pending] = useActionState<SavedSearchState, FormData>(
    createSavedSearch,
    {},
  );

  if (!signedIn || Object.keys(params).length === 0) return null;

  return (
    <form action={action} className="inline-flex items-center gap-2">
      {Object.entries(params).map(([key, value]) => (
        <input key={key} type="hidden" name={`p_${key}`} value={value} />
      ))}
      <button type="submit" className="jumplink" disabled={pending}>
        {pending ? "Saving…" : "Save search"}
      </button>
      {state.ok && <Toast message={state.ok} />}
      {state.error && (
        <span role="alert" className="text-micro text-live">
          {state.error}
        </span>
      )}
    </form>
  );
}
