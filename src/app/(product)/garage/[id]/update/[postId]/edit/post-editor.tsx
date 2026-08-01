"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import type { ActivityBlock } from "@/lib/activity-blocks";

import {
  deleteActivityPost,
  updateActivityPost,
  type ActionState,
} from "../../../../actions";
import { ActivityBlockEditor } from "../../activity-block-editor";

export function PostEditor({
  carId,
  userId,
  postId,
  title,
  intro,
  videoUrl,
  plainText,
  isRich,
  initialBlocks,
  publicHref,
}: {
  carId: string;
  userId: string;
  postId: string;
  title: string;
  intro: string;
  videoUrl: string;
  plainText: string;
  /** True when the body holds image/multi-block content — gets the full block editor. */
  isRich: boolean;
  initialBlocks: ActivityBlock[];
  publicHref: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateActivityPost, {});
  const [deleteState, deleteAction, deletePending] = useActionState<ActionState, FormData>(
    deleteActivityPost,
    {}
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="deck">
      <form action={action} className="tile flex flex-col gap-3">
        <input type="hidden" name="post_id" value={postId} />

        <label className="field !mb-0">
          <span className="microlabel">Title</span>
          <input
            name="title"
            required
            maxLength={160}
            defaultValue={title}
            className="ctl max-w-none"
          />
        </label>

        <label className="field !mb-0">
          <span className="microlabel">Standfirst — optional</span>
          <input name="intro" maxLength={2000} defaultValue={intro} className="ctl max-w-none" />
        </label>

        {isRich ? (
          <div className="field !mb-0">
            <span className="microlabel">What happened</span>
            <div className="mt-2">
              <ActivityBlockEditor carId={carId} userId={userId} initialBlocks={initialBlocks} />
            </div>
          </div>
        ) : (
          <label className="field !mb-0">
            <span className="microlabel">What happened</span>
            <textarea name="body" rows={5} defaultValue={plainText} className="ctl !max-w-none" />
          </label>
        )}

        <label className="field !mb-0">
          <span className="microlabel">Video — optional</span>
          <input
            name="video_url"
            type="url"
            defaultValue={videoUrl}
            placeholder="https://youtube.com/…"
            className="ctl max-w-none"
          />
          <span className="field__hint">YouTube links only.</span>
        </label>

        {state.error && (
          <p role="alert" aria-live="polite" className="field__err">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p role="status" aria-live="polite" className="chip chip--ok">
            {state.ok}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {publicHref ? (
            <Link href={publicHref} className="jumplink">
              View the public entry →
            </Link>
          ) : (
            <span />
          )}
          <button type="submit" disabled={pending} className="btn btn--live">
            {pending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      <section className="tile">
        <span className="microlabel microlabel--ink">Remove this entry</span>
        <p className="spec-note">
          Deleting takes it off the car sheet and the feed, along with its photos and any comments.
        </p>
        <div className="mt-3">
          {confirmingDelete ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="btn btn--ghost"
              >
                Keep it
              </button>
              <form action={deleteAction}>
                <input type="hidden" name="post_id" value={postId} />
                <input type="hidden" name="car_id" value={carId} />
                <button type="submit" className="btn btn--live" disabled={deletePending}>
                  {deletePending ? "Deleting…" : "Delete permanently"}
                </button>
              </form>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="relbtn !static"
            >
              Delete this entry
            </button>
          )}
          {deleteState?.error && (
            <p role="alert" aria-live="polite" className="field__err mt-2">
              {deleteState.error}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
