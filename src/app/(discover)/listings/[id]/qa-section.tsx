"use client";

import { useActionState, useOptimistic, useState } from "react";

import { askQuestion, type CommerceState } from "@/features/commerce/actions";

export type QAItem = {
  id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  authorName: string;
  isSeller: boolean;
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** One question or reply, plus its own replies nested underneath. */
function Thread({
  item,
  replies,
  listingId,
  isLoggedIn,
  depth,
  action,
  pending,
}: {
  item: QAItem;
  replies: QAItem[];
  listingId: string;
  isLoggedIn: boolean;
  depth: number;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [replying, setReplying] = useState(false);

  return (
    <div id={`q-${item.id}`} style={depth > 0 ? { marginLeft: 16 } : undefined}>
      <div className={`msg ${item.isSeller ? "msg--me" : ""}`}>
        <span className="msg__who">
          {item.authorName}
          {item.isSeller && <span className="chip chip--ok ml-2 normal-case">Seller</span>}
        </span>
        <p className="msg__body">{item.body}</p>
        <span className="msg__meta">
          {item.id.startsWith("optimistic-") ? "Posting…" : formatTimestamp(item.created_at)}
        </span>
        {isLoggedIn && !replying && (
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="jumplink !mt-1 justify-self-start text-xs"
          >
            Reply
          </button>
        )}
        {replying && (
          <form
            action={(formData) => {
              setReplying(false);
              action(formData);
            }}
            className="composer__row mt-1"
          >
            <input type="hidden" name="listing_id" value={listingId} />
            <input type="hidden" name="parent_id" value={item.id} />
            <input
              name="body"
              required
              autoFocus
              aria-label={`Reply to ${item.authorName}`}
              placeholder="Write a reply…"
              className="ctl flex-1"
            />
            <button type="submit" disabled={pending} className="btn">
              Post
            </button>
            <button type="button" onClick={() => setReplying(false)} className="jumplink text-xs">
              Cancel
            </button>
          </form>
        )}
      </div>
      {replies.map((child) => (
        <Thread
          key={child.id}
          item={child}
          replies={[]}
          listingId={listingId}
          isLoggedIn={isLoggedIn}
          depth={depth + 1}
          action={action}
          pending={pending}
        />
      ))}
    </div>
  );
}

/**
 * Q&A as annotations — 2px spines, never chat bubbles.
 *
 * Threaded: `listing_questions.parent_id` lets any reply hang off any
 * question or earlier reply, not just a single seller answer, so a buyer can
 * follow up and the seller (or another buyer) can keep answering down the
 * thread. Every message carries a visible timestamp and an `id={q-<id>}`
 * anchor so a link to a specific question or answer resolves directly to it.
 */
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

  // The record is the receipt: the question appears in the thread the moment
  // it's posted, marked "Posting…" until the server revalidates. On failure
  // React reverts the optimistic entry automatically and `state.error`
  // explains what happened — no perceived-loss moment where the composer
  // clears and nothing appears.
  const [optimisticItems, addOptimistic] = useOptimistic<QAItem[], QAItem>(
    items,
    (current, added) => [...current, added]
  );

  const submit = (formData: FormData) => {
    const body = String(formData.get("body") ?? "").trim();
    if (body) {
      addOptimistic({
        id: `optimistic-${Date.now()}`,
        parent_id: (formData.get("parent_id") as string | null) || null,
        body,
        created_at: new Date().toISOString(),
        authorName: isSeller ? "You (seller)" : "You",
        isSeller,
      });
    }
    action(formData);
  };

  const topLevel = optimisticItems.filter((i) => !i.parent_id);
  const repliesFor = (id: string) => optimisticItems.filter((i) => i.parent_id === id);

  return (
    <div className="mt-10">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">Questions for the seller</span>
        {topLevel.length > 0 && <span className="chip">{topLevel.length}</span>}
      </div>
      <p className="spec-note !mt-1">
        Public — anyone viewing this listing can read these questions and answers.{" "}
        {isSeller
          ? "Buyers you've sold to can also message you privately from their order."
          : "Private, order-specific messaging opens once you buy — use this thread for anything the next buyer would want to know too."}
      </p>

      <div className="thread mt-3">
        {topLevel.map((q) => (
          <Thread
            key={q.id}
            item={q}
            replies={repliesFor(q.id)}
            listingId={listingId}
            isLoggedIn={isLoggedIn}
            depth={0}
            action={submit}
            pending={pending}
          />
        ))}
        {topLevel.length === 0 && (
          <div className="undrawn">
            <span className="undrawn__mark" aria-hidden="true">
              ?
            </span>
            <h3>No questions yet</h3>
            <p>Ask the seller anything — answers appear here for everyone.</p>
          </div>
        )}
      </div>

      {isLoggedIn && !isSeller && (
        <form action={submit} className="composer">
          <div className="composer__row">
            <input type="hidden" name="listing_id" value={listingId} />
            <input name="body" required aria-label="Ask the seller a question" placeholder="Ask the seller a question…" className="ctl max-w-none flex-1" />
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
