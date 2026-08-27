"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";

import { Message, MessageThread, ResultNote, ThreadDivider } from "@/components/ui";
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
  const endRef = useRef<HTMLDivElement>(null);
  const [state, action, pending] = useActionState<CommerceState, FormData>(sendThreadMessage, {});

  // Opening the live thread lands the reader at the newest message, the way
  // any conversation surface does — not at a months-old first page. History
  // mode (?before=) is the explicit request for the past, so it stays put.
  const latestId = messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (!viewingHistory && latestId) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [viewingHistory, latestId]);

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
        <MessageThread>
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
              <ThreadDivider>{group.label}</ThreadDivider>
              {group.items.map((m) => (
                <Message
                  key={m.id}
                  me={m.sender_id === currentUserId}
                  who={m.sender_id === currentUserId ? "You" : m.sender_name}
                  when={m.created_at}
                  whenLabel={timeLabel(m.created_at)}
                  body={m.body}
                />
              ))}
            </div>
          ))}
        </MessageThread>
      ) : (
        <p className="spec-note">
          No messages yet. Anything about delivery, fitment or condition belongs here — it stays
          attached to the order.
        </p>
      )}

      {viewingHistory && (
        <div className="flex justify-center border-t border-[color:var(--rule-soft)] pt-3">
          {/* A composer here would suggest replying from an old point in the
              record — the only reply path is the latest window. */}
          <Link href={`/messages/${orderId}`} className="btn btn--ghost">
            Back to latest to reply
          </Link>
        </div>
      )}

      {!viewingHistory && (
        <div className="composer--pin grid gap-2" ref={endRef}>
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
          <ResultNote error={state.error} ok={state.ok} />
        </div>
      )}
      {viewingHistory && <ResultNote error={state.error} ok={state.ok} />}
    </div>
  );
}
