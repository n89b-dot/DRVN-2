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
    <section className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-base font-semibold text-text-primary">Build updates</h2>
      <p className="mt-1 text-sm text-text-muted">
        Post an update — it appears on the car&apos;s Activity tab.
      </p>

      <form action={action} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="car_id" value={carId} />
        <input
          name="title"
          required
          placeholder="Title (e.g. Downpipe + tune installed)"
          className="h-11 rounded-input border border-border bg-app px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />
        <textarea
          name="body"
          rows={4}
          placeholder="What happened?"
          className="resize-y rounded-input border border-border bg-app px-3 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />
        <input
          name="video_url"
          type="url"
          placeholder="Video URL (optional — YouTube etc.)"
          className="h-11 rounded-input border border-border bg-app px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />
        {state.error && <p className="text-sm text-red-400">{state.error}</p>}
        <div className="flex items-center justify-between">
          <Link
            href={`/garage/${carId}/update/new`}
            className="text-sm text-accent hover:underline"
          >
            Open the full editor — photos, text blocks & YouTube →
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="rounded-pill bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90"
          >
            {pending ? "Posting…" : "Post update"}
          </button>
        </div>
      </form>

      {posts.length > 0 && (
        <ul className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
          {posts.map((post) => (
            <li key={post.id} className="flex items-center justify-between text-sm">
              <span className="text-text-secondary">{post.title}</span>
              <span className="text-text-muted">
                {post.published_at ? new Date(post.published_at).toLocaleDateString() : "Draft"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
