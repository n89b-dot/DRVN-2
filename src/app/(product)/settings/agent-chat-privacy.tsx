"use client";

import { useState } from "react";

import { ResultNote, TileHead } from "@/components/ui";
import { AGENT_CHAT_CLEARED, useAgentEvent } from "@/features/agent/chat-events";
import { ClearAgentChat } from "@/features/agent/clear-agent-chat";

/**
 * Settings → Privacy: the member's stored chat with their agent, and Clear
 * chat (N125). Here, not only beside the thread, because the thread is
 * hidden while the agent is Off or its chat step is closed, and the data
 * rules promise clearing at any time. Shown whenever there are messages.
 */
export function AgentChatPrivacy({ messages }: { messages: number }) {
  const [cleared, setCleared] = useState<string | null>(null);
  // Cleared beside the thread instead (the side panel over this page).
  useAgentEvent(AGENT_CHAT_CLEARED, () => setCleared((current) => current ?? "Chat cleared."));
  return (
    <section id="agent-chat" className="tile">
      <TileHead label="Your chat with your agent" />
      {cleared ? (
        <ResultNote ok={cleared} />
      ) : (
        <>
          <p className="field__hint max-w-[62ch]">
            {messages.toLocaleString()} {messages === 1 ? "message" : "messages"}, yours and your agent&apos;s, kept until 12 months after the last
            one. Clearing deletes them all, whatever your agent is set to.
          </p>
          <div className="mt-3">
            <ClearAgentChat onCleared={setCleared} />
          </div>
        </>
      )}
    </section>
  );
}
