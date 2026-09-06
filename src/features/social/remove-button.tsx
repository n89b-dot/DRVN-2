"use client";

import { useActionState } from "react";

import { removeFollow, removeSave, type SocialRemovalState } from "./actions";

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
  const mutation = kind === "save" ? removeSave : removeFollow;
  const [state, action, pending] = useActionState<SocialRemovalState, FormData>(mutation, {});

  return (
    <form action={action}>
      <input type="hidden" name="target_type" value={targetType} />
      <input type="hidden" name="target_id" value={targetId} />
      <button type="submit" disabled={pending} className="relbtn !static inline-flex min-h-11 items-center">
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
