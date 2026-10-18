"use client";

import { useState, useTransition } from "react";

import type { SocialRemovalState } from "./actions";

export function RelationshipRemove({
  kind,
  targetType,
  targetId,
  label,
}: {
  kind: "save" | "follow";
  targetType: "listing" | "car" | "profile" | "post";
  targetId: string;
  label: string;
}) {
  const [state, setState] = useState<SocialRemovalState>({});
  const [pending, startTransition] = useTransition();

  return (
    <form onSubmit={event => {
      event.preventDefault();
      if (pending) return;
      setState({});
      startTransition(async () => {
        try {
          const response = await fetch("/api/social/remove", { method: "POST", body: new URLSearchParams({ kind, target_type: targetType, target_id: targetId }), signal: AbortSignal.timeout(15000) });
          const result = await response.json() as SocialRemovalState;
          if (!response.ok || result.error) { setState({ error: result.error ?? "Couldn't remove that. Please try again." }); return; }
          // Reload only after confirmed removal. Keep tab/search/sort in the
          // URL; don't couple this mutation to an appended RSC render.
          window.location.reload();
        } catch { setState({ error: "Couldn't confirm the removal. Try again; repeating it is safe." }); }
      });
    }}>
      <input type="hidden" name="target_type" value={targetType} />
      <input type="hidden" name="target_id" value={targetId} />
      <button type="submit" disabled={pending} className="relbtn !static inline-flex min-h-10 items-center">
        {pending ? "Removing…" : label}
      </button>
      {state.error && (
        <span role="alert" aria-live="polite" className="field__err mt-1 block max-w-40">
          {state.error}
        </span>
      )}
    </form>
  );
}
