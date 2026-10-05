"use client";

import { unstable_rethrow } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import { EmptyState, Message, MessageComposer, MessageThread, TileHead } from "@/components/ui";
import { askQuestion, type CommerceState } from "@/features/commerce/actions";
import { useHydrated } from "@/lib/hooks/useHydrated";

export type QAItem = {
  id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  authorName: string;
  isSeller: boolean;
  optimistic?: boolean;
};

type SubmitQuestion = (formData: FormData, onSuccess?: () => void) => void;

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
  result,
}: {
  item: QAItem;
  replies: QAItem[];
  listingId: string;
  isLoggedIn: boolean;
  depth: number;
  action: SubmitQuestion;
  pending: boolean;
  result: CommerceState;
}) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const [operationId, setOperationId] = useState("");

  const startReply = () => {
    if (!operationId) setOperationId(crypto.randomUUID());
    setReplying(true);
  };

  return (
    <div id={`q-${item.id}`} style={depth > 0 ? { marginLeft: 16 } : undefined}>
      <Message
        me={item.isSeller}
        who={item.authorName}
        whoEnd={item.isSeller && <span className="chip chip--ok ml-2 normal-case">Seller</span>}
        body={item.body}
        meta={item.optimistic ? "Posting…" : formatTimestamp(item.created_at)}
      >
        {isLoggedIn && !replying && (
          <button
            type="button"
            onClick={startReply}
            className="jumplink !mt-1 justify-self-start text-xs"
          >
            Reply
          </button>
        )}
        {replying && (
          <form
            action={(formData) => action(formData, () => {
              setDraft("");
              setOperationId("");
              setReplying(false);
            })}
            className="composer__row mt-1"
          >
            <input type="hidden" name="listing_id" value={listingId} />
            <input type="hidden" name="parent_id" value={item.id} />
            <input type="hidden" name="operation_id" value={operationId} />
            <input
              name="body"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={pending}
              required
              autoFocus
              aria-label={`Reply to ${item.authorName}`}
              placeholder="Write a reply…"
              className="ctl flex-1"
            />
            <button type="submit" disabled={pending || !operationId || !draft.trim()} className="btn">
              {pending && result.operationId === operationId ? "Posting…" : "Post"}
            </button>
            <button type="button" onClick={() => setReplying(false)} className="jumplink text-xs">
              Cancel
            </button>
          </form>
        )}
      </Message>
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
          result={result}
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
  const [state, setState] = useState<CommerceState>({});
  const [pending, startTransition] = useTransition();
  // Controlled fields must not replace what was typed before hydration
  // (see useHydrated): they stay disabled until the page is live.
  const ready = useHydrated();
  const [draft, setDraft] = useState("");
  const [operationId, setOperationId] = useState("");

  // The record is the receipt: the question appears in the thread the moment
  // it's posted, marked "Posting…" until the server revalidates. On failure
  // React reverts the optimistic entry automatically and `state.error`
  // explains what happened — no perceived-loss moment where the composer
  // clears and nothing appears.
  const [optimisticItems, addOptimistic] = useOptimistic<QAItem[], QAItem>(
    items,
    (current, added) => [...current, added]
  );

  const submit: SubmitQuestion = (formData, onSuccess) => {
    const body = String(formData.get("body") ?? "").trim();
    const submittedOperationId = String(formData.get("operation_id") ?? "");
    startTransition(async () => {
      setState({ operationId: submittedOperationId });
      if (body && submittedOperationId) {
        addOptimistic({
          id: submittedOperationId,
          parent_id: String(formData.get("parent_id") ?? "") || null,
          body,
          created_at: new Date().toISOString(),
          authorName: isSeller ? "You (seller)" : "You",
          isSeller,
          optimistic: true,
        });
      }
      try {
        const result = await askQuestion({}, formData);
        setState(result);
        if (result.ok && result.operationId === submittedOperationId) onSuccess?.();
      } catch (error) {
        unstable_rethrow(error);
        setState({
          error: "The response was interrupted. Your text is still here — try posting it again.",
          operationId: submittedOperationId,
        });
      }
    });
  };

  const topLevel = optimisticItems.filter((i) => !i.parent_id);
  const repliesFor = (id: string) => optimisticItems.filter((i) => i.parent_id === id);

  return (
    <div className="mt-10">
      <TileHead
        label={isSeller ? "Buyers' questions" : "Questions for the seller"}
        end={topLevel.length > 0 ? <span className="chip">{topLevel.length}</span> : undefined}
      />
      <p className="spec-note !mt-1">
        Public — anyone viewing this listing can read these questions and answers.{" "}
        {isSeller
          ? "Buyers you've sold to can also message you privately from their order."
          : "Private, order-specific messaging opens once you buy — use this thread for anything the next buyer would want to know too."}
      </p>

      <MessageThread className="mt-3">
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
            result={state}
          />
        ))}
        {topLevel.length === 0 && (
          isSeller ? (
            <EmptyState mark="?" title="No questions yet">
              Buyers&apos; questions appear here, and you&apos;re notified when one arrives. Your answer is
              public, so the next buyer sees it too.
            </EmptyState>
          ) : (
            <EmptyState mark="?" title="No questions yet">
              Ask the seller anything — answers appear here for everyone.
            </EmptyState>
          )
        )}
      </MessageThread>

      {isLoggedIn && !isSeller && (
        <fieldset disabled={!ready} className="contents">
        <MessageComposer
          block
          action={(formData) => submit(formData, () => {
            setDraft("");
            setOperationId("");
          })}
          hidden={{ listing_id: listingId, operation_id: operationId }}
          value={draft}
          onChange={(event) => {
            if (!operationId) setOperationId(crypto.randomUUID());
            setDraft(event.target.value);
          }}
          inputLabel="Ask the seller a question"
          placeholder="Ask the seller a question…"
          pending={pending}
          sendLabel="Ask"
          pendingLabel="Ask"
          ghost={false}
        />
        </fieldset>
      )}
      {state.error && (
        <p role="alert" aria-live="polite" className="field__err mt-2">
          {state.error}
        </p>
      )}
    </div>
  );
}
