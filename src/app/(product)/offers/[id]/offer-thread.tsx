"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import { AnimatePresence, motion } from "motion/react";

import { Message, MessageThread, ResultNote } from "@/components/ui";
import { expand } from "@/lib/motion";

import {
  acceptCounter,
  respondToOffer,
  sendThreadMessage,
  withdrawOffer,
  type CommerceState,
} from "../actions";

function money(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export type ThreadMessage = {
  id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
};

/**
 * The full offer thread: message history, composer, and the actions
 * appropriate to this viewer's role and the offer's current status.
 * Mirrors the buttons that used to live inline on /orders (offer-row.tsx)
 * — same server actions, same hidden fields, just given room to breathe on
 * their own page instead of squeezed into a list row.
 */
export function OfferThread({
  offerId,
  amountCents,
  counterAmountCents,
  status,
  incoming,
  currentUserId,
  messages,
}: {
  offerId: string;
  amountCents: number;
  counterAmountCents: number | null;
  status: string;
  incoming: boolean;
  currentUserId: string;
  messages: ThreadMessage[];
}) {
  const [respondState, respond, responding] = useActionState<CommerceState, FormData>(
    respondToOffer,
    {}
  );
  const [withdrawState, withdraw, withdrawing] = useActionState<CommerceState, FormData>(
    withdrawOffer,
    {}
  );
  const [counterState, takeCounter, takingCounter] = useActionState<CommerceState, FormData>(
    acceptCounter,
    {}
  );
  const [messageState, sendMessage, sendingMessage] = useActionState<CommerceState, FormData>(
    sendThreadMessage,
    {}
  );
  const [showCounter, setShowCounter] = useState(false);

  const live = status === "open" || status === "countered";

  const hasDecision = Boolean(
    (incoming && live) || (!incoming && status === "countered" && counterAmountCents) || (!incoming && live)
  );

  return (
    <>
      {/* The decision leads (SYS — "who acts next"): Accept/Counter/Pass or
          the buyer's counter-acceptance sit ABOVE the thread, so on a phone
          the expected action never hides below a long conversation. The
          composer stays at the bottom, conversation-native. */}
      {hasDecision && (
        <div className="mt-4 flex flex-col gap-2">
        {incoming && live && (
          <>
            <div className="flex flex-wrap gap-2">
              <form action={respond}>
                <input type="hidden" name="offer_id" value={offerId} />
                <input type="hidden" name="decision" value="accepted" />
                <button type="submit" disabled={responding} className="btn btn--live">
                  Accept {money(counterAmountCents ?? amountCents)}
                </button>
              </form>
              <button
                type="button"
                onClick={() => setShowCounter((v) => !v)}
                className="btn btn--ghost"
                aria-expanded={showCounter}
              >
                Counter
              </button>
              <form action={respond}>
                <input type="hidden" name="offer_id" value={offerId} />
                <input type="hidden" name="decision" value="declined" />
                <button type="submit" disabled={responding} className="btn btn--ghost">
                  Pass
                </button>
              </form>
            </div>

            {/* The counter composer unfolds instead of shoving the thread
                down in one frame — the expansion ties it to the Counter
                button that caused it. */}
            <AnimatePresence initial={false}>
              {showCounter && (
                <motion.div
                  key="counter"
                  variants={expand}
                  initial="collapsed"
                  animate="expanded"
                  exit="collapsed"
                  className="overflow-hidden"
                >
                  <form action={respond} className="composer__row">
                    <input type="hidden" name="offer_id" value={offerId} />
                    <input type="hidden" name="decision" value="countered" />
                    <input
                      name="counter_amount"
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      placeholder="Your number"
                      className="ctl max-w-none flex-1 !py-2"
                    />
                    <button type="submit" disabled={responding} className="btn btn--live !py-2.5">
                      Send counter
                    </button>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {!incoming && status === "countered" && counterAmountCents && (
          <form action={takeCounter}>
            <input type="hidden" name="offer_id" value={offerId} />
            <button type="submit" disabled={takingCounter} className="btn btn--live">
              {takingCounter ? "Confirming…" : `Accept counter ${money(counterAmountCents)}`}
            </button>
          </form>
        )}

        {!incoming && live && (
          <form action={withdraw}>
            <input type="hidden" name="offer_id" value={offerId} />
            <button type="submit" disabled={withdrawing} className="relbtn !static">
              Withdraw offer
            </button>
          </form>
        )}

        <ResultNote error={respondState.error} ok={respondState.ok} />
        <ResultNote error={withdrawState.error} ok={withdrawState.ok} />
        <ResultNote error={counterState.error} ok={counterState.ok} />
        </div>
      )}

      {messages.length > 0 && (
        <MessageThread className="mt-4">
          {messages.map((m) => (
            <Message
              key={m.id}
              me={m.sender_id === currentUserId}
              who={
                <>
                  {m.sender_id === currentUserId ? "You" : m.sender_name}
                  {" · "}
                  {new Date(m.created_at).toLocaleString(undefined, {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </>
              }
              body={m.body}
            />
          ))}
        </MessageThread>
      )}

      <div className="mt-4 flex flex-col gap-2 border-t border-[color:var(--rule-soft)] pt-4">
        {/* Messaging survives the offer closing — a declined thread should
            still read back, not vanish. */}
        <form action={sendMessage} className="composer__row">
          <input type="hidden" name="offer_id" value={offerId} />
          <input
            name="body"
            required
            maxLength={4000}
            placeholder="Message…"
            className="ctl max-w-none flex-1 !py-2"
          />
          <button type="submit" disabled={sendingMessage} className="btn btn--ghost !py-2.5">
            {sendingMessage ? "Sending…" : "Send"}
          </button>
        </form>
        <ResultNote error={messageState.error} ok={messageState.ok} />
      </div>
    </>
  );
}

/** Link into checkout for an accepted offer — the same destination the
 *  "offer accepted" notification sends the buyer to. */
export function CheckoutLink({ orderId }: { orderId: string }) {
  return (
    <Link href={`/orders/${orderId}/checkout`} className="btn btn--live">
      Complete checkout →
    </Link>
  );
}
