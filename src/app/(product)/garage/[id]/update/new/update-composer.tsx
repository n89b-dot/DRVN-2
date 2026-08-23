"use client";

import { useActionState, useState } from "react";

import type { ActivityBlock } from "@/lib/activity-blocks";

import { createRichActivityPost, saveActivityDraft, type ActionState } from "../../../actions";
import { ActivityBlockEditor } from "../activity-block-editor";

export function UpdateComposer({
  carId,
  userId,
  initialTitle,
  initialBlocks,
  draftSavedAt,
}: {
  carId: string;
  userId: string;
  /** Seeded from the car's draft when one exists. */
  initialTitle?: string;
  initialBlocks?: ActivityBlock[];
  draftSavedAt?: string;
}) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createRichActivityPost,
    {}
  );
  const [draftState, draftAction, draftPending] = useActionState<ActionState, FormData>(
    saveActivityDraft,
    {}
  );

  // What the footer says about the draft: freshly saved beats loaded-from.
  const draftNote = draftState.ok
    ? "Draft saved — only you can see it"
    : draftSavedAt
      ? `Draft from ${new Date(draftSavedAt).toLocaleDateString()} — only you can see it`
      : "Draft — only you can see this";

  return (
    // The writing surface is a bounded sheet (read.cv's card): the tile's
    // edge answers "where do I type" before any placeholder has to.
    <form action={action} className="tile tile--deep mt-4">
      <input type="hidden" name="car_id" value={carId} />

      <input
        name="title"
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title your update"
        className="w-full border-b border-[color:var(--rule-soft)] bg-transparent pb-3 text-[clamp(22px,3vw,30px)] font-[600] tracking-[-0.02em] outline-none placeholder:text-dim focus:border-[color:var(--rule-mid)]"
      />

      <div className="mt-5">
        <ActivityBlockEditor carId={carId} userId={userId} initialBlocks={initialBlocks} />
      </div>

      {(state.error || draftState.error) && (
        <p role="alert" aria-live="polite" className="field__err mt-3">
          {state.error ?? draftState.error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--rule-mid)] pt-5">
        <span className="microlabel" aria-live="polite">
          {draftNote}
        </span>
        <span className="flex items-center gap-3">
          {/* Same form, different action: the draft keeps whatever the form
              holds right now, without the publish gate on blocks. */}
          <button
            type="submit"
            formAction={draftAction}
            disabled={draftPending || pending || !title.trim()}
            className="btn btn--ghost"
          >
            {draftPending ? "Saving…" : "Save draft"}
          </button>
          <button
            type="submit"
            disabled={pending || draftPending || !title.trim()}
            className="btn btn--live"
          >
            {pending ? "Publishing…" : "Publish update"}
          </button>
        </span>
      </div>
    </form>
  );
}
