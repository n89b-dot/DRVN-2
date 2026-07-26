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

/** Q&A as message annotations on the sheet — 2px spines, never chat bubbles. */
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
    <div className="mt-10">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">Asked on the sheet</span>
        {topLevel.length > 0 && <span className="chip">{topLevel.length}</span>}
      </div>

      <div className="thread">
        {topLevel.map((q) => (
          <div key={q.id}>
            <div className="msg">
              <span className="msg__who">{q.authorName}</span>
              <p className="msg__body">{q.body}</p>
            </div>
            {repliesFor(q.id).map((r) => (
              <div key={r.id} className="msg msg--me ml-4">
                <span className="msg__who">{r.authorName} — seller</span>
                <p className="msg__body">{r.body}</p>
              </div>
            ))}
            {isSeller && repliesFor(q.id).length === 0 && (
              <form action={action} className="composer__row ml-4 py-2">
                <input type="hidden" name="listing_id" value={listingId} />
                <input type="hidden" name="parent_id" value={q.id} />
                <input name="body" required placeholder="Reply as the keeper…" className="ctl flex-1" />
                <button type="submit" disabled={pending} className="btn">
                  Reply
                </button>
              </form>
            )}
          </div>
        ))}
        {topLevel.length === 0 && (
          <p className="py-2 font-mono text-[12.5px] text-dim">
            No questions yet — the sheet answers what it can.
          </p>
        )}
      </div>

      {isLoggedIn && !isSeller && (
        <form action={action} className="composer">
          <div className="composer__row">
            <input type="hidden" name="listing_id" value={listingId} />
            <input name="body" required placeholder="Ask the keeper a question…" className="ctl max-w-none flex-1" />
            <button type="submit" disabled={pending} className="btn">
              Ask
            </button>
          </div>
        </form>
      )}
      {state.error && (
        <p role="alert" aria-live="polite" className="field__err mt-2">
          {state.error}
        </p>
      )}
    </div>
  );
}
