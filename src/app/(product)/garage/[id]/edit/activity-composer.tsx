"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import { CountedField } from "@/components/ui";
import { ACTIVITY_TITLE_MAX } from "@/lib/limits";

import { createActivityPost, type ActionState } from "../../actions";

/**
 * Build-update section with the empty → form → list lifecycle: an invitation
 * (or the filed list) at rest, one composer at a time on demand. The form no
 * longer sits permanently open above the list — posting is an intent, not
 * the section's resting state.
 */
export function ActivityComposer({
  carId,
  posts,
}: {
  carId: string;
  posts: { id: string; title: string; published_at: string | null }[];
}) {
  const [composing, setComposing] = useState(false);
  // Remount the form fresh on every open: action state (including a stale
  // error from a cancelled attempt) must not survive a collapse.
  const [openCount, setOpenCount] = useState(0);

  return (
    <section className="tile">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">Build updates</span>
        {!composing && (
          <button
            type="button"
            onClick={() => {
              setOpenCount((n) => n + 1);
              setComposing(true);
            }}
            className="btn btn--ghost"
          >
            Post an update
          </button>
        )}
      </div>

      {composing && (
        <ComposerForm key={openCount} carId={carId} onDone={() => setComposing(false)} />
      )}

      {posts.length > 0 && (
        <ul className={`feed ${composing ? "mt-5 border-t border-[color:var(--rule-soft)] pt-2" : "mt-2"}`}>
          {posts.map((post) => (
            <li key={post.id}>
              <Link
                href={`/garage/${carId}/update/${post.id}/edit`}
                className="min-w-0 flex-1 truncate transition-colors hover:text-live"
              >
                {post.title}
              </Link>
              <span className="amt">
                {post.published_at ? new Date(post.published_at).toLocaleDateString() : "Draft"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {posts.length === 0 && !composing && (
        <p className="field__hint mt-1">
          Nothing posted yet — updates appear on the car&apos;s public build page as soon as you
          publish them.
        </p>
      )}
    </section>
  );
}

function ComposerForm({ carId, onDone }: { carId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createActivityPost, {});

  // Success closes the composer; the list gaining the row is the receipt.
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={action} className="mt-2 flex flex-col gap-4">
      <input type="hidden" name="car_id" value={carId} />
      <CountedField
        id="post-title"
        name="title"
        label="Title"
        max={ACTIVITY_TITLE_MAX}
        required
        autoFocus
        placeholder="Downpipe + tune installed"
      />
      <div className="field !mb-0">
        <label htmlFor="post-body" className="microlabel">
          What happened
        </label>
        <textarea
          id="post-body"
          name="body"
          rows={4}
          className="ctl"
          placeholder="The story — parts, numbers, what's next."
        />
      </div>
      <div className="field !mb-0">
        <label htmlFor="post-video" className="microlabel">
          Video URL — optional
        </label>
        <input
          id="post-video"
          name="video_url"
          type="url"
          placeholder="https://youtube.com/…"
          className="ctl max-w-none"
        />
      </div>
      {state.error && (
        <p role="alert" aria-live="polite" className="field__err">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/garage/${carId}/update/new`} className="jumplink">
          Open the full editor — photos, text blocks &amp; YouTube →
        </Link>
        <div className="flex items-center gap-4">
          <button type="button" onClick={onDone} className="jumplink">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="btn btn--live">
            {pending ? "Publishing…" : "Publish update"}
          </button>
        </div>
      </div>
    </form>
  );
}
