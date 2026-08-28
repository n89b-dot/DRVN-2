"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import type { ActivityBlock } from "@/lib/activity-blocks";
import { BuildStoryComposer, type ComposerServerAction } from "@/features/composer/composer";

import { deleteActivityPost, type ActionState } from "../../../../actions";

/**
 * Editing a filed build entry — the same Build Story Composer as creation
 * (one editor, M3), plus the delete section. Legacy intro/video fields ride
 * through as hidden values so a body edit never silently strips them.
 */
export function PostEditor({
  carId,
  userId,
  postId,
  title,
  intro,
  videoUrl,
  initialBlocks,
  publicHref,
  mods,
  publishAction,
}: {
  carId: string;
  userId: string;
  postId: string;
  title: string;
  intro: string;
  videoUrl: string;
  initialBlocks: ActivityBlock[];
  publicHref: string | null;
  mods: { id: string; label: string }[];
  publishAction: ComposerServerAction;
}) {
  const [deleteState, deleteAction, deletePending] = useActionState<ActionState, FormData>(
    deleteActivityPost,
    {}
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="grid gap-6">
      {publicHref && (
        <Link href={publicHref} className="jumplink justify-self-start">
          View the public post ↗
        </Link>
      )}

      <BuildStoryComposer
        carId={carId}
        userId={userId}
        mods={mods}
        postId={postId}
        initialTitle={title}
        initialBlocks={initialBlocks}
        publishAction={publishAction}
        extraHidden={{ intro, video_url: videoUrl }}
      />

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
