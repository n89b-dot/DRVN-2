"use client";

import { useActionState, useState } from "react";

import { createRichActivityPost, type ActionState } from "../../../actions";
import { ActivityBlockEditor } from "../activity-block-editor";

export function UpdateComposer({ carId, userId }: { carId: string; userId: string }) {
  const [title, setTitle] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createRichActivityPost,
    {}
  );

  return (
    <form action={action} className="mt-4">
      <input type="hidden" name="car_id" value={carId} />

      <input
        name="title"
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title your update"
        className="w-full bg-transparent text-[clamp(24px,3vw,34px)] font-[600] tracking-[-0.02em] outline-none placeholder:text-dim/50"
      />

      <div className="mt-6">
        <ActivityBlockEditor carId={carId} userId={userId} />
      </div>

      {state.error && (
        <p role="alert" aria-live="polite" className="field__err mt-3">{state.error}</p>
      )}

      <div className="mt-8 flex items-center justify-end gap-3 border-t border-[color:var(--rule-mid)] pt-5">
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="btn btn--live"
        >
          {pending ? "Publishing…" : "Publish update"}
        </button>
      </div>
    </form>
  );
}
