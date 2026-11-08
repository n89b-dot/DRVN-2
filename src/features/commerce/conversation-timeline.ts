import type { DealEvent } from "./deals";

/**
 * One conversation's timeline: messages grouped into runs, lifecycle events
 * between them, day breaks. Pure; the caller supplies how a timestamp maps to
 * a calendar day so the thread can bucket in the reader's own timezone.
 */

export type TimelineMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  kind: "message" | "event";
  /** `order:<id>` / `offer:<id>` — what the message is about. */
  dealKey: string | null;
  /** Resolved (signed) photo URLs. */
  photos: string[];
  read_at: string | null;
};

export type TimelineItem =
  | { type: "day"; key: string; at: string }
  | { type: "event"; key: string; at: string; actor: string | null; text: string; joiner: string; live: boolean; dealKey: string | null }
  | { type: "run"; key: string; at: string; me: boolean; senderId: string; dealKey: string | null; messages: TimelineMessage[]; seen: boolean };

/** Consecutive messages further apart than this start a new run. */
const RUN_GAP_MS = 10 * 60 * 1000;

export function buildTimeline({
  messages,
  events,
  me,
  otherName,
  dayOf,
}: {
  messages: TimelineMessage[];
  events: DealEvent[];
  me: string;
  otherName: string;
  /** Calendar-day key for a timestamp (e.g. local YYYY-MM-DD). */
  dayOf: (iso: string) => string;
}): TimelineItem[] {
  type Entry = { at: string; order: number; message?: TimelineMessage; event?: DealEvent };
  // Events sort before a message at the same instant: "Kaito offered $5,900"
  // reads before the note that came with it.
  const entries: Entry[] = [
    ...events.map((event) => ({ at: event.at, order: 0, event })),
    ...messages.map((message) => ({ at: message.created_at, order: 1, message })),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);

  const items: TimelineItem[] = [];
  let day: string | null = null;
  let run: Extract<TimelineItem, { type: "run" }> | null = null;

  for (const entry of entries) {
    const entryDay = dayOf(entry.at);
    if (entryDay !== day) {
      day = entryDay;
      run = null;
      items.push({ type: "day", key: `day:${entryDay}`, at: entry.at });
    }

    if (entry.event) {
      run = null;
      items.push({
        type: "event",
        key: entry.event.key,
        at: entry.event.at,
        actor: entry.event.actor,
        text: entry.event.text,
        joiner: " ",
        live: entry.event.live,
        dealKey: entry.event.dealKey,
      });
      continue;
    }

    const message = entry.message!;
    if (message.kind === "event") {
      run = null;
      items.push({
        type: "event",
        key: `msg:${message.id}`,
        at: message.created_at,
        actor: message.sender_id === me ? "You" : otherName,
        text: message.body,
        joiner: " · ",
        live: false,
        dealKey: message.dealKey,
      });
      continue;
    }

    const mine = message.sender_id === me;
    const last = run?.messages.at(-1);
    const continues =
      run &&
      run.senderId === message.sender_id &&
      run.dealKey === message.dealKey &&
      last &&
      new Date(message.created_at).getTime() - new Date(last.created_at).getTime() <= RUN_GAP_MS;

    if (continues && run) {
      run.messages.push(message);
    } else {
      run = {
        type: "run",
        key: `run:${message.id}`,
        at: message.created_at,
        me: mine,
        senderId: message.sender_id,
        dealKey: message.dealKey,
        messages: [message],
        seen: false,
      };
      items.push(run);
    }
  }

  // "Seen" belongs under your newest run, when its last message was read.
  const lastRun = [...items].reverse().find((item) => item.type === "run");
  if (lastRun && lastRun.type === "run" && lastRun.me && lastRun.messages.at(-1)?.read_at) {
    lastRun.seen = true;
  }

  return items;
}

/** The deal a message row is about, as a timeline/composer key. */
export function messageDealKey(row: { order_id: string | null; offer_id: string | null; listing_id?: string | null }): string | null {
  if (row.order_id) return `order:${row.order_id}`;
  if (row.offer_id) return `offer:${row.offer_id}`;
  // A "Message seller" enquiry is about its listing (R-directcontact).
  if (row.listing_id) return `listing:${row.listing_id}`;
  return null;
}
