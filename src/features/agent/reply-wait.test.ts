import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "./chat";
import { mergeMessages, waitForReply } from "./reply-wait";

const msg = (id: string): ChatMessage => ({ id, role: id.startsWith("m") ? "member" : "agent", body: id, cards: [], images: [], created_at: "2026-11-07T10:00:00Z" });
const REQUEST = "33333333-3333-4333-8333-333333333333";

/** OS-W04 follow-up: a retry that finds its first attempt still running gets that attempt's reply, once, without a second send. */
describe("waiting for a pending send's reply", () => {
  it("keeps the request id, asks until the reply lands, and shows each message once", async () => {
    const poll = vi.fn()
      .mockResolvedValueOnce({ messages: [msg("m-1")], pending: { requestId: REQUEST } })
      .mockResolvedValueOnce({ messages: [msg("m-1"), msg("r-1")] });
    let shown: ChatMessage[] = [msg("m-0")];
    const result = await waitForReply({ messages: [msg("m-1")], pending: { requestId: REQUEST } }, poll, {
      everyMs: 3_000, forMs: 150_000, alive: () => true, sleep: async () => {}, onProgress: (incoming) => void (shown = mergeMessages(shown, incoming)),
    });
    expect(poll).toHaveBeenCalledTimes(2);
    expect(poll).toHaveBeenNthCalledWith(1, REQUEST);
    expect(poll).toHaveBeenNthCalledWith(2, REQUEST);
    expect(result.pending).toBeUndefined();
    shown = mergeMessages(shown, result.messages);
    expect(shown.map((m) => m.id)).toEqual(["m-0", "m-1", "r-1"]);
  });

  it("gives up after its window, still pending, so the caller keeps the id", async () => {
    let clock = 0;
    const poll = vi.fn(async () => ({ messages: [msg("m-1")], pending: { requestId: REQUEST } }));
    const result = await waitForReply({ pending: { requestId: REQUEST } }, poll, {
      everyMs: 3_000, forMs: 9_000, alive: () => true, onProgress: () => {}, sleep: async (ms) => void (clock += ms), now: () => clock,
    });
    expect(result.pending).toEqual({ requestId: REQUEST });
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("doesn't ask again when the chat closed during the wait", async () => {
    let open = true;
    const poll = vi.fn();
    await waitForReply({ pending: { requestId: REQUEST } }, poll, { everyMs: 1, forMs: 10_000, alive: () => open, onProgress: () => {}, sleep: async () => void (open = false) });
    expect(poll).not.toHaveBeenCalled();
  });

  it("stops asking once the chat is closed, and doesn't ask at all for a finished send", async () => {
    const poll = vi.fn();
    expect(await waitForReply({ messages: [msg("m-1"), msg("r-1")] }, poll, { everyMs: 1, forMs: 10, alive: () => true, onProgress: () => {} })).toEqual({ messages: [msg("m-1"), msg("r-1")] });
    await waitForReply({ pending: { requestId: REQUEST } }, poll, { everyMs: 1, forMs: 10, alive: () => false, onProgress: () => {} });
    expect(poll).not.toHaveBeenCalled();
  });
});
