"use client";

import { useActionState } from "react";

import { askQuestion, type CommerceState } from "@/features/commerce/actions";

export type QAItem = {
  id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  authorName: string;
  isSeller: boolean;
};

export function QASection({
  listingId,
  items,
  isLoggedIn,
  isSeller,
}: {
  listingId: string;
  items: QAItem[];
  isLoggedIn: boolean;
  isSeller: boolean;
}) {
  const [state, action, pending] = useActionState<CommerceState, FormData>(askQuestion, {});

  const topLevel = items.filter((i) => !i.parent_id);
  const repliesFor = (id: string) => items.filter((i) => i.parent_id === id);

  return (
    <div className="mt-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
        Questions & answers
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {topLevel.map((q) => (
          <div key={q.id} className="rounded-card border border-border bg-surface p-4">
            <p className="text-xs text-text-muted">{q.authorName}</p>
            <p className="mt-1 text-sm text-text-secondary">{q.body}</p>
            {repliesFor(q.id).map((r) => (
              <div key={r.id} className="mt-3 border-l-2 border-accent/40 pl-3">
                <p className="text-xs text-accent">{r.authorName} (seller)</p>
                <p className="mt-0.5 text-sm text-text-secondary">{r.body}</p>
              </div>
            ))}
            {isSeller && repliesFor(q.id).length === 0 && (
              <form action={action} className="mt-3 flex gap-2">
                <input type="hidden" name="listing_id" value={listingId} />
                <input type="hidden" name="parent_id" value={q.id} />
                <input
                  name="body"
                  required
                  placeholder="Reply as seller…"
                  className="h-10 flex-1 rounded-input border border-border bg-app px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
                />
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-pill bg-accent px-4 text-sm font-semibold text-white"
                >
                  Reply
                </button>
              </form>
            )}
          </div>
        ))}
        {topLevel.length === 0 && (
          <p className="text-sm text-text-muted">No questions yet.</p>
        )}
      </div>

      {isLoggedIn && !isSeller && (
        <form action={action} className="mt-4 flex gap-2">
          <input type="hidden" name="listing_id" value={listingId} />
          <input
            name="body"
            required
            placeholder="Ask the seller a question…"
            className="h-11 flex-1 rounded-input border border-border bg-surface px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-pill bg-accent px-5 text-sm font-semibold text-white"
          >
            Ask
          </button>
        </form>
      )}
      {state.error && <p className="mt-2 text-sm text-red-400">{state.error}</p>}
    </div>
  );
}
