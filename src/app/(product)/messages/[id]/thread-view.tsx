"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Button, MessageBubble, MessageRun, ThreadDivider, ThreadEvent } from "@/components/ui";
import { buildTimeline, type TimelineMessage } from "@/features/commerce/conversation-timeline";
import { ConversationComposer, type ComposerDeal } from "@/features/commerce/conversation-composer";
import type { DealEvent } from "@/features/commerce/deals";
import { LiveConversation } from "@/features/commerce/live-messages";
import { OfferDecision } from "@/features/commerce/offer-decision";
import { dayKeyIn, validTimeZone, VIEWER_TZ_COOKIE } from "@/lib/viewer-timezone";

export type LiveOffer = {
  id: string;
  status: string;
  amountCents: number;
  counterAmountCents: number | null;
  incoming: boolean;
  title: string;
  expiresAt: string | null;
  round: number;
};

function dayLabel(iso: string, timeZone: string): string {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  const day = dayKeyIn(iso, timeZone);
  if (day === dayKeyIn(now.toISOString(), timeZone)) return "Today";
  if (day === dayKeyIn(yesterday.toISOString(), timeZone)) return "Yesterday";
  const sameYear = day.slice(0, 4) === dayKeyIn(now.toISOString(), timeZone).slice(0, 4);
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
}

function timeLabel(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { timeZone, hour: "numeric", minute: "2-digit" });
}

/** Within this distance of the end, the reader is "at the latest" and new
 *  messages are followed; further up, they're reading history (RR-14). */
const PINNED_SLACK_PX = 160;

/** The browser's zone doesn't change while the page is open. */
const noSubscription = () => () => {};

function nearPageEnd(): boolean {
  const doc = document.documentElement;
  return window.innerHeight + window.scrollY >= doc.scrollHeight - PINNED_SLACK_PX;
}

/**
 * Take the reader to the latest message without animating. The page's
 * `scroll-behavior: smooth` would otherwise run the scroll through the whole
 * history, and every frame of it fires the scroll listener below with the
 * reader far from the end — un-pinning them, so a message landing mid-scroll
 * showed "1 new message" instead of being followed. It also kept moving the
 * page after it looked settled: a reader who scrolled up at that moment was
 * carried a frame further down.
 */
function scrollToLatest(end: HTMLElement | null) {
  end?.scrollIntoView({ block: "end", behavior: "instant" });
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
  initialTimeZone,
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
  /** The zone the server rendered in (the viewer's cookie, else UTC). The
   *  first browser render uses it too, so both build the same tree. */
  initialTimeZone: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  // RR-13: hydrate in the zone the server rendered in, then switch to the
  // reader's real zone — and remember it, so the next server render uses it.
  const timeZone = useSyncExternalStore(
    noSubscription,
    () => validTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? initialTimeZone,
    () => initialTimeZone,
  );
  useEffect(() => {
    if (timeZone === initialTimeZone) return;
    document.cookie = `${VIEWER_TZ_COOKIE}=${encodeURIComponent(timeZone)}; path=/; max-age=31536000; samesite=lax`;
  }, [timeZone, initialTimeZone]);
  const timeline = useMemo(
    () => buildTimeline({ messages, events, me, otherName, dayOf: (iso) => dayKeyIn(iso, timeZone) }),
    [messages, events, me, otherName, timeZone],
  );
  // The about tag only earns its place when there's more than one deal.
  const showAbout = Object.keys(aboutLabels).length > 1;

  // RR-14: land on the newest message once, then follow new ones only while
  // the reader is at the latest (or sent it themselves). Someone scrolled up
  // reading history keeps their place and gets a "new messages" button.
  const latest = messages.at(-1);
  const latestId = latest?.id ?? null;
  const latestMine = latest?.sender_id === me;
  const messageCount = messages.length;
  const pinned = useRef(true);
  const landed = useRef(false);
  // How many messages the reader had at the latest; a refresh can bring
  // several at once, and the button counts all of them.
  const seenCount = useRef(0);
  const countRef = useRef(messageCount);
  useEffect(() => {
    countRef.current = messageCount;
  });
  const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      pinned.current = nearPageEnd();
      if (pinned.current) {
        seenCount.current = countRef.current;
        setUnseen(0);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (viewingHistory || !latestId) return;
    if (!landed.current || pinned.current || latestMine) {
      landed.current = true;
      scrollToLatest(endRef.current);
      pinned.current = true;
      seenCount.current = messageCount;
      setUnseen(0);
    } else {
      setUnseen(Math.max(1, messageCount - seenCount.current));
    }
  }, [viewingHistory, latestId, latestMine, messageCount]);

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
                  <span suppressHydrationWarning>{dayLabel(item.at, timeZone)}</span>
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
              whenLabel={timeLabel(item.at, timeZone)}
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
              round={offer.round}
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
          floating={
            unseen > 0 ? (
              <Button
                variant="live"
                onClick={() => {
                  scrollToLatest(endRef.current);
                  pinned.current = true;
                  seenCount.current = messageCount;
                  setUnseen(0);
                }}
              >
                {unseen === 1 ? "1 new message" : `${unseen} new messages`} ↓
              </Button>
            ) : undefined
          }
        />
      )}
      <div ref={endRef} aria-hidden="true" />

      {!viewingHistory && <LiveConversation conversationId={conversationId} />}
    </>
  );
}
