"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";

import { MessageBubble, MessageRun, ThreadDivider, ThreadEvent } from "@/components/ui";
import { buildTimeline, type TimelineMessage } from "@/features/commerce/conversation-timeline";
import { ConversationComposer, type ComposerDeal } from "@/features/commerce/conversation-composer";
import type { DealEvent } from "@/features/commerce/deals";
import { LiveConversation } from "@/features/commerce/live-messages";
import { OfferDecision } from "@/features/commerce/offer-decision";

export type LiveOffer = {
  id: string;
  status: string;
  amountCents: number;
  counterAmountCents: number | null;
  incoming: boolean;
  title: string;
  expiresAt: string | null;
};

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (localDay(iso) === localDay(today.toISOString())) return "Today";
  if (localDay(iso) === localDay(yesterday.toISOString())) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * A person-first conversation: what was said and what happened, in order,
 * in the reader's own timezone. Runs of one side's messages share a name and
 * time; events (offers, shipping, dispute notes) sit between them; a live
 * offer is decided at the foot of the thread, right above the reply box.
 */
export function ThreadView({
  conversationId,
  me,
  otherId,
  otherName,
  messages,
  events,
  aboutLabels,
  liveOffers,
  composerDeals,
  composerDefault,
  hasEarlier,
  earliest,
  viewingHistory,
  basePath,
}: {
  conversationId: string | null;
  me: string;
  otherId: string;
  otherName: string;
  messages: TimelineMessage[];
  events: DealEvent[];
  /** deal key → short part name, for the run's "about" tag. */
  aboutLabels: Record<string, string>;
  liveOffers: LiveOffer[];
  composerDeals: ComposerDeal[];
  composerDefault: string | null;
  hasEarlier: boolean;
  earliest: string | null;
  viewingHistory: boolean;
  basePath: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const timeline = useMemo(
    () => buildTimeline({ messages, events, me, otherName, dayOf: localDay }),
    [messages, events, me, otherName],
  );
  // The about tag only earns its place when there's more than one deal.
  const showAbout = Object.keys(aboutLabels).length > 1;

  // Land on the newest message, and follow new ones as they arrive.
  const latestId = messages.at(-1)?.id ?? null;
  useEffect(() => {
    if (!viewingHistory) endRef.current?.scrollIntoView({ block: "end" });
  }, [viewingHistory, latestId]);

  return (
    <>
      {viewingHistory && (
        <p className="field__hint">
          Viewing earlier messages —{" "}
          <Link href={basePath} className="jumplink">
            back to the latest →
          </Link>
        </p>
      )}

      <div className="convthread" aria-live="polite">
        {hasEarlier && earliest && (
          <div className="flex justify-center pb-2">
            <Link href={`${basePath}?before=${encodeURIComponent(earliest)}`} className="jumplink">
              ← Earlier messages
            </Link>
          </div>
        )}

        {timeline.length === 0 && (
          <p className="field__hint text-center">
            Nothing said yet. Questions about fitment, condition or delivery go here — {otherName} sees them straight away.
          </p>
        )}

        {timeline.map((item) => {
          if (item.type === "day") {
            return (
              <div key={item.key} className="convthread__day">
                <ThreadDivider>
                  <span suppressHydrationWarning>{dayLabel(item.at)}</span>
                </ThreadDivider>
              </div>
            );
          }
          if (item.type === "event") {
            return (
              <ThreadEvent key={item.key} live={item.live} when={item.at}>
                {item.actor ? (
                  <span>
                    <b>{item.actor}</b>
                    {item.joiner}
                    {item.text}
                  </span>
                ) : (
                  <span>{item.text}</span>
                )}
              </ThreadEvent>
            );
          }
          return (
            <MessageRun
              key={item.key}
              me={item.me}
              who={item.me ? "You" : otherName}
              when={item.at}
              whenLabel={timeLabel(item.at)}
              about={showAbout && item.dealKey ? aboutLabels[item.dealKey] : undefined}
              foot={item.seen ? "Seen" : undefined}
            >
              {item.messages.map((m) => (
                <MessageBubble key={m.id} photos={m.photos} photoAlt={`Photo from ${item.me ? "you" : otherName}`}>
                  {m.body || undefined}
                </MessageBubble>
              ))}
            </MessageRun>
          );
        })}

        {!viewingHistory &&
          liveOffers.map((offer) => (
            <OfferDecision
              key={offer.id}
              offerId={offer.id}
              status={offer.status}
              amountCents={offer.amountCents}
              counterAmountCents={offer.counterAmountCents}
              incoming={offer.incoming}
              counterpartyName={otherName}
              partTitle={offer.title}
              expiresAt={offer.expiresAt}
            />
          ))}
      </div>

      {viewingHistory ? (
        <div className="flex justify-center pt-3">
          <Link href={basePath} className="jumplink">
            Back to the latest to reply →
          </Link>
        </div>
      ) : (
        <ConversationComposer
          meId={me}
          otherId={otherId}
          otherFirstName={otherName}
          deals={composerDeals}
          defaultDealKey={composerDefault}
        />
      )}
      <div ref={endRef} aria-hidden="true" />

      {!viewingHistory && <LiveConversation conversationId={conversationId} />}
    </>
  );
}
