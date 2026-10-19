"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { AgentResultCard } from "@/components/commerce";
import { Button, ButtonLink, ChatComposer, FilterButton, MessageBubble, MessageRun, MessageThread, ResultNote } from "@/components/ui";
import { confirmBuildChange } from "./build";
import type { ResolvedCard } from "./cards";
import { sendAgentMessage, type ChatMessage } from "./chat";
import type { ChatAbout } from "./chat-load";
import { formatPrice } from "@/lib/marketplace/taxonomy";

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Starters above the composer (design 02): each fills the box, never sends. They follow what you opened it from. */
const STARTERS = ["Will this fit my car?", "What do parts like this sell for?", "Update my build", "Find parts for my car", "What's my agent doing?"];
function startersFor(about: ChatAbout | null): string[] {
  if (!about) return STARTERS;
  if (about.kind === "car") return ["Update my build", "Find parts for my car", "What's on this car?"];
  return about.mine ? ["What do parts like this sell for?", "How is this listing doing?"] : ["Will this fit my car?", "What do parts like this sell for?"];
}

/**
 * The agent thread on /agent and in the desktop side panel (A3c): the member's messages and the agent's
 * replies, the listings a reply pointed at as result cards, starters and the
 * composer. One message, one model turn, stored server-side
 * (src/features/agent/chat.ts). The agent looks things up and explains; it
 * never sets a price or a limit from here — those stay on the listing and
 * offer pages.
 */
export function AgentChat({ initial, about = null }: { initial: ChatMessage[]; about?: ChatAbout | null }) {
  const [messages, setMessages] = useState(initial);
  // What the next message is about: the opener's listing or car, until the
  // member clears it. A new opener (the panel reopened from elsewhere) resets it.
  const [context, setContext] = useState(about);
  const [contextFrom, setContextFrom] = useState(about);
  if (about?.id !== contextFrom?.id) {
    setContextFrom(about);
    setContext(about);
  }
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sent = useRef(false);
  const section = useRef<HTMLElement>(null);

  // After a send, bring the reply into view: the page's end, where the
  // composer settles under the thread instead of covering the newest line.
  useEffect(() => {
    if (!sent.current) return;
    sent.current = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = still ? "auto" : "smooth";
    // In the side panel its own body scrolls; on /agent, the page.
    const scroller = section.current?.closest(".sidepanel__body");
    if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    else window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
  }, [messages]);

  function send() {
    const text = draft.trim();
    if (!text || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendAgentMessage({ text, about: context ? { kind: context.kind, id: context.id } : undefined });
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
    <section ref={section} className="agentchat mt-6" aria-label="Chat with your agent">
      {messages.length > 0 && (
        <MessageThread>
          {messages.map((message) => (
            <MessageRun key={message.id} me={message.role === "member"} who={message.role === "member" ? "You" : "Agent"} when={message.created_at} whenLabel={time(message.created_at)}>
              <MessageBubble>{message.body}</MessageBubble>
              {message.cards.map((card) =>
                card.kind === "listing" ? (
                  <AgentResultCard
                    key={card.id}
                    eyebrow="Listing"
                    title={card.title}
                    meta={formatPrice(card.priceCents)}
                    image={{ src: card.image ?? undefined, alt: card.title }}
                    href={card.href}
                  />
                ) : (
                  <BuildChangeCard key={card.id} card={card} />
                ),
              )}
            </MessageRun>
          ))}
        </MessageThread>
      )}

      <div className="agentchat__starters mt-4 flex flex-wrap gap-2" role="group" aria-label="Starters">
        {startersFor(context).map((starter) => (
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
        above={
          context ? (
            <div className="chatbox__topic">
              <span>
                About: <b className="text-ink">{context.label}</b>
                {context.kind === "listing" && (context.mine ? ", your listing" : "")}
              </span>
              <Button variant="quiet" onClick={() => setContext(null)} aria-label={`Stop asking about ${context.label}`}>
                ✕
              </Button>
            </div>
          ) : undefined
        }
        below={<ResultNote error={error} />}
      />
    </section>
  );
}

/**
 * "Update my build" as a confirm card (design 05): the exact change, then
 * Confirm or Edit. Confirm saves it through the mods editor's own save; Edit
 * opens the editor with the line filled in. Once saved it offers to list the
 * part that came off.
 */
function BuildChangeCard({ card }: { card: Extract<ResolvedCard, { kind: "build_change" }> }) {
  const [applied, setApplied] = useState(card.applied);
  const [sellHref, setSellHref] = useState(card.sellHref);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await confirmBuildChange(card.id);
        if (result.error) setError(result.error);
        if (result.ok) {
          setApplied(true);
          setSellHref(result.sellHref ?? null);
        }
      } catch (caught) {
        unstable_rethrow(caught);
        setError("Couldn't save that. Try again, or open the editor.");
      }
    });
  }

  const change = card.replaces ? `Add to your ${card.carName}; mark ${card.replaces} removed` : `Add to your ${card.carName}`;
  return (
    <div className="grid gap-2">
      <AgentResultCard
        eyebrow={applied ? "Build updated" : "Update your build"}
        title={card.part}
        meta={applied ? (card.replaces ? `On your ${card.carName}; ${card.replaces} came off` : `On your ${card.carName}`) : change}
        image={card.image ? { src: card.image, alt: card.part } : undefined}
        href={applied ? card.href : card.editHref}
        action={
          applied ? (
            sellHref ? (
              <ButtonLink href={sellHref} variant="ghost">
                List the old one
              </ButtonLink>
            ) : undefined
          ) : (
            <div className="flex gap-2">
              <Button variant="live" onClick={confirm} loading={pending} pendingLabel="Saving…">
                Confirm
              </Button>
              <ButtonLink href={card.editHref} variant="ghost">
                Edit
              </ButtonLink>
            </div>
          )
        }
      />
      <ResultNote error={error} />
    </div>
  );
}
