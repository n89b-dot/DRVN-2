import type { ChatMessage, ChatState } from "./chat";

/**
 * A pending send, followed to its reply (OS-W04 follow-up): while the
 * server says `pending`, show what it has (the member's message) and ask
 * again every `everyMs`, until the reply is stored, `forMs` has passed, or
 * the chat is gone. Returns the last answer; still `pending` means it gave up
 * waiting, and the caller keeps the request id so a resend picks it up.
 */
export async function waitForReply(
  first: ChatState,
  poll: (requestId: string) => Promise<ChatState>,
  options: {
    everyMs: number;
    forMs: number;
    alive: () => boolean;
    onProgress: (messages: ChatMessage[]) => void;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<ChatState> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const giveUpAt = now() + options.forMs;
  let result = first;
  while (result.pending && options.alive() && now() < giveUpAt) {
    options.onProgress(result.messages ?? []);
    await sleep(options.everyMs);
    // The chat may have closed while this waited.
    if (!options.alive()) break;
    result = await poll(result.pending.requestId);
  }
  return result;
}

/** Messages added by id: one already shown isn't shown twice. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[] = []): ChatMessage[] {
  return [...current, ...incoming.filter((message) => !current.some((shown) => shown.id === message.id))];
}
