"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { AgentResultCard } from "@/components/commerce";
import { ChatComposer, FilterButton, MessageBubble, MessageRun, MessageThread, ResultNote } from "@/components/ui";
import { sendAgentMessage, type ChatMessage } from "@/features/agent/chat";
import { formatPrice } from "@/lib/marketplace/taxonomy";

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Starters above the composer (design 02): each fills the box, never sends. */
const STARTERS = ["Will this fit my car?", "What do parts like this sell for?", "Find parts for my car", "What's my agent doing?"];

/**
 * The agent thread on /agent (A3c): the member's messages and the agent's
 * replies, the listings a reply pointed at as result cards, starters and the
 * composer. One message, one model turn, stored server-side
 * (src/features/agent/chat.ts). The agent looks things up and explains; it
 * never sets a price or a limit from here — those stay on the listing and
 * offer pages.
 */
export function AgentChat({ initial }: { initial: ChatMessage[] }) {
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sent = useRef(false);

  // After a send, bring the reply into view: the page's end, where the
  // composer settles under the thread instead of covering the newest line.
  useEffect(() => {
    if (!sent.current) return;
    sent.current = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: still ? "auto" : "smooth" });
  }, [messages]);

  function send() {
    const text = draft.trim();
    if (!text || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendAgentMessage({ text });
        if (result.error) setError(result.error);
        if (result.messages?.length) {
          sent.current = true;
          setMessages((current) => [...current, ...result.messages!]);
          setDraft("");
        }
      } catch (caught) {
        unstable_rethrow(caught);
        setError("Couldn't reach your agent. Your message is still here; try again.");
      }
    });
  }

  return (
    <section className="agentchat mt-6" aria-label="Chat with your agent">
      {messages.length > 0 && (
        <MessageThread>
          {messages.map((message) => (
            <MessageRun key={message.id} me={message.role === "member"} who={message.role === "member" ? "You" : "Agent"} when={message.created_at} whenLabel={time(message.created_at)}>
              <MessageBubble>{message.body}</MessageBubble>
              {message.cards.map((card) => (
                <AgentResultCard
                  key={card.id}
                  eyebrow="Listing"
                  title={card.title}
                  meta={formatPrice(card.priceCents)}
                  image={{ src: card.image ?? undefined, alt: card.title }}
                  href={card.href}
                />
              ))}
            </MessageRun>
          ))}
        </MessageThread>
      )}

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Starters">
        {STARTERS.map((starter) => (
          <FilterButton key={starter} onClick={() => setDraft(starter)}>
            {starter}
          </FilterButton>
        ))}
      </div>

      <ChatComposer
        value={draft}
        onValueChange={setDraft}
        onSend={send}
        canSend={draft.trim().length > 0}
        pending={pending}
        placeholder="Ask your agent…"
        inputLabel="Message your agent"
        below={<ResultNote error={error} />}
      />
    </section>
  );
}
