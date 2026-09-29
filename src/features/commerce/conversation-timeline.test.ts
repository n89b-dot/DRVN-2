import { describe, expect, it } from "vitest";

import { buildTimeline, messageDealKey, type TimelineMessage } from "./conversation-timeline";
import type { DealEvent } from "./deals";

const ME = "me";
const THEM = "them";
const utcDay = (iso: string) => iso.slice(0, 10);

function msg(id: string, sender: string, at: string, patch: Partial<TimelineMessage> = {}): TimelineMessage {
  return { id, sender_id: sender, body: `body ${id}`, created_at: at, kind: "message", dealKey: "order:o1", photos: [], read_at: null, ...patch };
}

describe("buildTimeline", () => {
  it("groups one side's consecutive messages into a run, with day breaks", () => {
    const items = buildTimeline({
      messages: [
        msg("a", THEM, "2026-09-22T10:00:00Z"),
        msg("b", THEM, "2026-09-22T10:05:00Z"),
        msg("c", ME, "2026-09-22T10:06:00Z"),
        msg("d", ME, "2026-09-23T09:00:00Z"),
      ],
      events: [],
      me: ME,
      otherName: "Kaito",
      dayOf: utcDay,
    });
    expect(items.map((i) => (i.type === "run" ? `run:${i.messages.map((m) => m.id).join("")}` : i.type))).toEqual([
      "day",
      "run:ab",
      "run:c",
      "day",
      "run:d",
    ]);
  });

  it("breaks a run on a long gap or a different deal", () => {
    const items = buildTimeline({
      messages: [
        msg("a", THEM, "2026-09-22T10:00:00Z"),
        msg("b", THEM, "2026-09-22T10:30:00Z"),
        msg("c", THEM, "2026-09-22T10:31:00Z", { dealKey: "offer:f1" }),
      ],
      events: [],
      me: ME,
      otherName: "Kaito",
      dayOf: utcDay,
    });
    expect(items.filter((i) => i.type === "run")).toHaveLength(3);
  });

  it("puts events between messages, before a message at the same instant, and renders stored notes as events", () => {
    const event: DealEvent = { key: "offer:f1:made", at: "2026-09-22T10:00:00Z", dealKey: "offer:f1", actor: "Kaito", text: "offered $1,200.00", live: false };
    const items = buildTimeline({
      messages: [
        msg("a", THEM, "2026-09-22T10:00:00Z"),
        msg("n", THEM, "2026-09-22T11:00:00Z", { kind: "event", body: "Opened a dispute — Not as described." }),
      ],
      events: [event],
      me: ME,
      otherName: "Kaito",
      dayOf: utcDay,
    });
    expect(items.map((i) => i.type)).toEqual(["day", "event", "run", "event"]);
    const note = items[3];
    expect(note.type === "event" && `${note.actor}${note.joiner}${note.text}`).toBe("Kaito · Opened a dispute — Not as described.");
  });

  it("says Seen only under your newest run once it was read", () => {
    const read = buildTimeline({
      messages: [msg("a", THEM, "2026-09-22T10:00:00Z"), msg("b", ME, "2026-09-22T10:01:00Z", { read_at: "2026-09-22T10:02:00Z" })],
      events: [],
      me: ME,
      otherName: "Kaito",
      dayOf: utcDay,
    });
    expect(read.filter((i) => i.type === "run").map((i) => i.type === "run" && i.seen)).toEqual([false, true]);

    const unread = buildTimeline({ messages: [msg("b", ME, "2026-09-22T10:01:00Z")], events: [], me: ME, otherName: "Kaito", dayOf: utcDay });
    expect(unread.some((i) => i.type === "run" && i.seen)).toBe(false);
  });
});

describe("messageDealKey", () => {
  it("prefers the order, then the offer", () => {
    expect(messageDealKey({ order_id: "o", offer_id: null })).toBe("order:o");
    expect(messageDealKey({ order_id: null, offer_id: "f" })).toBe("offer:f");
    expect(messageDealKey({ order_id: null, offer_id: null })).toBeNull();
  });
});
