"use client";

import Link from "next/link";
import { useActionState } from "react";

import { createActivityPost, type ActionState } from "../../actions";

export function ActivityComposer({
  carId,
  posts,
}: {
  carId: string;
  posts: { id: string; title: string; published_at: string | null }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createActivityPost, {});

  return (
    <section className="tile">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">Build entries</span>
      </div>
      <p className="field__hint">Post an entry — it lands in the sheet&apos;s activity the moment you file it.</p>

      <form action={action} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="car_id" value={carId} />
        <input
          name="title"
          required
          placeholder="Title (e.g. Downpipe + tune installed)"
          className="ctl max-w-none"
        />
        <textarea
          name="body"
          rows={4}
          placeholder="What happened?"
          className="ctl"
        />
        <input
          name="video_url"
          type="url"
          placeholder="Video URL (optional — YouTube etc.)"
          className="ctl max-w-none"
        />
        {state.error && (
          <p role="alert" aria-live="polite" className="field__err">
            {state.error}
          </p>
        )}
        <div className="flex items-center justify-between">
          <Link
            href={`/garage/${carId}/update/new`}
            className="jumplink"
          >
            Open the full editor — photos, text blocks & YouTube →
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="btn btn--live"
          >
            {pending ? "Filing…" : "File the entry"}
          </button>
        </div>
      </form>

      {posts.length > 0 && (
        <ul className="feed mt-5 border-t border-[color:var(--rule-soft)] pt-2">
          {posts.map((post) => (
            <li key={post.id}>
              {/* These were inert text spans — a filed entry had no route to an
                  editor because there wasn't one. */}
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
    </section>
  );
}
