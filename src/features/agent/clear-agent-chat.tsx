"use client";

import { buttonClass, ConfirmDialog } from "@/components/ui";
import { useRecoverableAction } from "@/features/commerce/use-recoverable-action";

import { clearAgentChat, type ClearChatState } from "./clear-chat";

/**
 * "Clear chat" (N125), under the agent thread on /agent and in the side
 * panel. Behind the shared confirm, because the thread can't be brought
 * back. The thread empties only once the server says it was cleared.
 */
export function ClearAgentChat({ onCleared }: { onCleared: (message: string) => void }) {
  const [state, submit, pending] = useRecoverableAction<ClearChatState>(async (previous, data) => {
    const result = await clearAgentChat(previous, data);
    if (result.ok) onCleared(result.ok);
    return result;
  }, "Couldn't confirm your chat was cleared. Reload to see where it stands.");
  return (
    <ConfirmDialog
      title="Clear your chat with your agent?"
      destructive
      consequences={[
        "Every message in this chat, yours and your agent's, is deleted for good",
        "Offers, listings and your build stay exactly as they are",
        "Your agent keeps working within the limits you set",
      ]}
      confirmLabel={pending ? "Clearing…" : "Clear chat"}
      cancelLabel="Keep it"
      onSubmit={submit}
      pending={pending}
      error={state.error}
      triggerClassName={buttonClass("quiet")}
    >
      Clear chat
    </ConfirmDialog>
  );
}
