"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { AuthIntentDialog, Toast } from "@/components/ui";

import { marketplaceHref } from "@/lib/marketplace/state";
import type { SavedSearchState } from "./saved-search-actions";

/**
 * The quiet `Save search` action (brief §C): appears only when the shopper
 * has actually built a state worth keeping, saves silently, and answers with
 * one toast. It never prompts, never opens a modal, and alerting is a
 * separate decision made later in Saved.
 */
export function SaveSearchButton({
  params,
  signedIn,
  resume = false,
}: {
  /** The current marketplace filter state (q, category, min…), empties omitted. */
  params: Record<string, string>;
  signedIn: boolean;
  resume?: boolean;
}) {
  const [state, setState] = useState<SavedSearchState>({});
  const [pending, startTransition] = useTransition();

  const formRef = useRef<HTMLFormElement>(null);
  const resumed = useRef(false);
  const [askAuth, setAskAuth] = useState(false);
  useEffect(() => {
    if (signedIn && resume && !resumed.current) { resumed.current = true; formRef.current?.requestSubmit(); }
  }, [signedIn, resume]);
  useEffect(() => {
    if (!resume || !state.ok) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("action") === "save_search") {
      url.searchParams.delete("action");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, [resume, state.ok]);
  if (Object.keys(params).length === 0) return null;
  if (!signedIn) return <><button type="button" className="jumplink" onClick={() => setAskAuth(true)}>Save search</button><AuthIntentDialog open={askAuth} onClose={() => setAskAuth(false)} intent="save_search" returnPath={marketplaceHref(params)} /></>;

  return (
    <form ref={formRef} className="inline-flex items-center gap-2" onSubmit={event => {
      event.preventDefault();
      if (pending) return;
      const body = new URLSearchParams();
      for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === "string") body.set(key, value);
      setState({});
      startTransition(async () => {
        try {
          const response = await fetch("/api/marketplace/saved-searches", { method: "POST", body, signal: AbortSignal.timeout(15000) });
          const result = await response.json() as SavedSearchState;
          setState(result.ok || result.error ? result : { error: "Couldn't save that search. Please try again." });
        } catch { setState({ error: "Couldn't confirm the save. Try again; the same search won't be saved twice." }); }
      });
    }}>
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
