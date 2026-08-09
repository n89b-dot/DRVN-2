"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";

import { sendThreadMessage, type CommerceState } from "@/features/commerce/actions";

type ThreadMessage = {
  id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
};

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Groups a run of messages into day buckets so a long thread reads as a
 * conversation history rather than an undated wall of text — each message
 * keeps its own time regardless.
 */
function groupByDay(messages: ThreadMessage[]): { label: string; items: ThreadMessage[] }[] {
  const groups: { label: string; items: ThreadMessage[] }[] = [];
  for (const m of messages) {
    const label = dayLabel(m.created_at);
    const current = groups[groups.length - 1];
    if (current && current.label === label) current.items.push(m);
    else groups.push({ label, items: [m] });
  }
  return groups;
}

function Result({ state }: { state: CommerceState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p role="alert" aria-live="polite" className={state.error ? "field__err" : "chip chip--ok"}>
      {state.error ?? state.ok}
    </p>
  );
}

/**
 * The messages/[orderId] thread — its own render, not a reuse of the order
 * page's <OrderThread>, so this surface can carry day grouping, per-message
 * times, and windowed history loading without touching the order detail page.
 */
export function ThreadView({
  orderId,
  currentUserId,
  messages,
  hasEarlier,
  earliestInWindow,
  viewingHistory,
}: {
  orderId: string;
  currentUserId: string;
  messages: ThreadMessage[];
  /** True when the window is full — there may be messages before it. */
  hasEarlier: boolean;
  /** created_at of the oldest message currently shown, for the "earlier" cursor. */
  earliestInWindow: string | null;
  /** True when `?before=` is set — i.e. this isn't the live/latest window. */
  viewingHistory: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<CommerceState, FormData>(sendThreadMessage, {});

  // A send that lands doesn't otherwise refresh this route (the action
  // revalidates the order page, not this one) — refresh explicitly so the new
  // message shows up, and clear the composer so a retry after a failure
  // doesn't leave stale text sitting under a stale error.
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state.ok, router]);

  const groups = groupByDay(messages);

  return (
    <div className="grid gap-3">
      {viewingHistory && (
        <div className="field__hint">
          Viewing earlier history —{" "}
          <Link href={`/messages/${orderId}`} className="jumplink">
            back to the latest →
          </Link>
        </div>
      )}

      {messages.length > 0 ? (
        <div className="thread">
          {hasEarlier && earliestInWindow && (
            <div className="flex justify-center pb-2">
              <Link
                href={`/messages/${orderId}?before=${encodeURIComponent(earliestInWindow)}`}
                className="jumplink"
              >
                ← Show earlier messages
              </Link>
            </div>
          )}
          {groups.map((group) => (
            <div key={group.label}>
              <div className="my-2 flex justify-center">
                <span className="microlabel">{group.label}</span>
              </div>
              {group.items.map((m) => (
                <div key={m.id} className={`msg ${m.sender_id === currentUserId ? "msg--me" : ""}`}>
                  <span className="msg__who">
                    {m.sender_id === currentUserId ? "You" : m.sender_name}
                    <time dateTime={m.created_at} className="ml-2 text-dim">
                      {timeLabel(m.created_at)}
                    </time>
                  </span>
                  <p className="msg__body">{m.body}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="spec-note">
          No messages yet. Anything about delivery, fitment or condition belongs here — it stays
          attached to the order.
        </p>
      )}

      {!viewingHistory && (
        <form ref={formRef} action={action} className="composer__row">
          <input type="hidden" name="order_id" value={orderId} />
          <input
            name="body"
            required
            maxLength={4000}
            placeholder="Message the other party…"
            className="ctl max-w-none flex-1 !py-2"
          />
          <button type="submit" disabled={pending} className="btn btn--ghost !py-2.5">
            {pending ? "Sending…" : "Send"}
          </button>
        </form>
      )}
      <Result state={state} />
    </div>
  );
}
