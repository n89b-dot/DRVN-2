"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import {
  acceptCounter,
  respondToOffer,
  sendThreadMessage,
  withdrawOffer,
  type CommerceState,
} from "@/features/commerce/actions";
import { StatusChip } from "./order-pipeline";

export type OfferView = {
  id: string;
  listing_id: string;
  listing_title: string;
  buyer_id: string;
  buyer_name: string;
  amount_cents: number;
  counter_amount_cents: number | null;
  status: string;
  /** Pre-formatted on the server — clock reads during render aren't pure. */
  expiresLabel: string | null;
  messages: { id: string; sender_id: string; sender_name: string; body: string }[];
};

function money(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

/** Feedback line shared by every action on the row. */
function Result({ state }: { state: CommerceState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p role="alert" aria-live="polite" className={state.error ? "field__err" : "chip chip--ok"}>
      {state.error ?? state.ok}
    </p>
  );
}

export function OfferRow({
  offer,
  incoming,
  currentUserId,
}: {
  offer: OfferView;
  incoming: boolean;
  currentUserId: string;
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

  const live = offer.status === "open" || offer.status === "countered";

  return (
    <div id={`offer-${offer.id}`} className="jobrow">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <StatusChip status={offer.status} />
          <Link
            href={`/listings/${offer.listing_id}`}
            className="order__name min-w-0 truncate transition-colors hover:text-live"
          >
            {offer.listing_title}
          </Link>
        </span>
        <span className="kv shrink-0 font-medium">
          {money(offer.amount_cents)}
          {offer.counter_amount_cents && (
            <> → countered {money(offer.counter_amount_cents)}</>
          )}
        </span>
      </div>

      <p className="order__meta mt-0.5">
        {incoming ? `${offer.buyer_name} makes the offer` : "Your offer"}
        {live && offer.expiresLabel && <> · {offer.expiresLabel}</>}
      </p>

      {/* The thread stays readable after a decline — it used to disappear the
          moment an offer closed, exactly when people want to re-read it. */}
      {offer.messages.length > 0 && (
        <div className="thread mt-3 border-t border-[color:var(--rule-soft)] pt-2">
          {offer.messages.map((m) => (
            <div
              key={m.id}
              className={`msg !py-1.5 ${m.sender_id === currentUserId ? "msg--me" : ""}`}
            >
              <span className="msg__who">
                {m.sender_id === currentUserId ? "You" : m.sender_name}
              </span>
              <p className="msg__body !text-[14px]">{m.body}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2 border-t border-[color:var(--rule-soft)] pt-3">
        {/* Messaging survives the offer closing. */}
        <form action={sendMessage} className="composer__row">
          <input type="hidden" name="offer_id" value={offer.id} />
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
        <Result state={messageState} />

        {incoming && live && (
          <>
            <div className="flex flex-wrap gap-2">
              <form action={respond}>
                <input type="hidden" name="offer_id" value={offer.id} />
                <input type="hidden" name="decision" value="accepted" />
                <button type="submit" disabled={responding} className="btn btn--live">
                  Accept {money(offer.counter_amount_cents ?? offer.amount_cents)}
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
                <input type="hidden" name="offer_id" value={offer.id} />
                <input type="hidden" name="decision" value="declined" />
                <button type="submit" disabled={responding} className="btn btn--ghost">
                  Pass
                </button>
              </form>
            </div>

            {showCounter && (
              <form action={respond} className="composer__row">
                <input type="hidden" name="offer_id" value={offer.id} />
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
            )}
          </>
        )}

        {!incoming && offer.status === "countered" && offer.counter_amount_cents && (
          <form action={takeCounter}>
            <input type="hidden" name="offer_id" value={offer.id} />
            <button type="submit" disabled={takingCounter} className="btn btn--live">
              {takingCounter ? "Confirming…" : `Accept counter ${money(offer.counter_amount_cents)}`}
            </button>
          </form>
        )}

        {!incoming && live && (
          <form action={withdraw}>
            <input type="hidden" name="offer_id" value={offer.id} />
            <button type="submit" disabled={withdrawing} className="relbtn !static">
              Withdraw offer
            </button>
          </form>
        )}

        <Result state={respondState} />
        <Result state={withdrawState} />
        <Result state={counterState} />
      </div>
    </div>
  );
}
