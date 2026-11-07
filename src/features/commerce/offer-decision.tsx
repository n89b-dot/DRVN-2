"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { OfferCard } from "@/components/commerce";
import { Button, ResultNote, TextField } from "@/components/ui";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { expand } from "@/lib/motion";

import { acceptCounter, counterOffer, respondToOffer, withdrawOffer, type CommerceState } from "./actions";
import { useRecoverableAction } from "./use-recoverable-action";

/**
 * The decision on a live offer, for whichever side is looking — shared by
 * the offer page and the conversation, so the negotiation can be settled
 * where it's being discussed.
 *
 *   seller, open       → Accept · Counter · Pass
 *   seller, countered  → waiting on the buyer (they hold the counter) · Pass
 *   buyer,  open       → waiting on the seller · Withdraw
 *   buyer,  countered  → Accept counter · Counter back · Withdraw
 *
 * Once the offer settles, only the result of this visit's move stays.
 *
 * A countered offer never offers the seller "Accept": accepting there would
 * reserve the part at a price the buyer never agreed to. Turns alternate and
 * a buyer has 3 offers per part, counter-backs included (negotiation v2);
 * the database enforces both, so this only decides what to show.
 */
export function OfferDecision({
  offerId,
  status,
  amountCents,
  counterAmountCents,
  incoming,
  counterpartyName,
  partTitle,
  expiresAt,
  round,
  buyerOffersLeft,
  block = false,
}: {
  offerId: string;
  status: string;
  amountCents: number;
  counterAmountCents: number | null;
  /** The reader is the seller. */
  incoming: boolean;
  counterpartyName: string;
  /** Shown in the card eyebrow when the card sits in a conversation. */
  partTitle?: string;
  expiresAt?: string | null;
  /** The offer's round count: every move says which round it was made at. */
  round: number;
  /** Buyer offers left on this part (of 3), when known. */
  buyerOffersLeft?: number;
  /** Full-width plate (the offer page) rather than a card in a conversation. */
  block?: boolean;
}) {
  const router = useRouter();
  const failure = "Couldn't confirm the offer update. Retry to check the saved result.";
  // A settled decision changes the whole page (status, history, the order it
  // became) — refresh it rather than waiting on revalidation.
  const refreshing =
    (action: (previous: CommerceState, data: FormData) => Promise<CommerceState>) =>
    async (previous: CommerceState, data: FormData) => {
      const result = await action(previous, data);
      if (result.ok) router.refresh();
      return result;
    };
  const [respondState, respond, responding] = useRecoverableAction<CommerceState>(refreshing(respondToOffer), failure);
  const [withdrawState, withdraw, withdrawing] = useRecoverableAction<CommerceState>(refreshing(withdrawOffer), failure);
  const [counterState, takeCounter, takingCounter] = useRecoverableAction<CommerceState>(refreshing(acceptCounter), failure);
  const [backState, counterBack, counteringBack] = useRecoverableAction<CommerceState>(refreshing(counterOffer), failure);
  const [showCounter, setShowCounter] = useState(false);
  const counterId = useId();

  const results = { respond: respondState, back: backState, withdraw: withdrawState, counter: counterState };

  // A move that settles the offer returns with the settled page (the action
  // revalidates it, then the refresh above), so the status prop can flip in
  // the commit next to the one that delivers the move's result. If the card
  // vanished with its buttons, the result ("Offer accepted", or "couldn't
  // notify the buyer — message them") showed only for the gap between those
  // two commits. So the result outlives the buttons: callers keep this
  // mounted across the settle, and a settled offer keeps what this visit's
  // move said — all but the lost-response notice, whose "check the saved
  // result" the settled page now answers.
  if (status !== "open" && status !== "countered") {
    const kept = Object.entries(results).filter(([, result]) => result.ok || (result.error && result.error !== failure));
    if (!kept.length) return null;
    return (
      <>
        {kept.map(([move, result]) => (
          <ResultNote key={move} error={result.error} ok={result.ok} />
        ))}
      </>
    );
  }

  const countered = status === "countered" && counterAmountCents != null;
  const live = countered ? counterAmountCents! : amountCents;
  const move = incoming ? status === "open" : countered;
  const expires = expiresAt ? expiryLabel(expiresAt) : null;
  const what = partTitle ? ` · ${partTitle}` : "";

  let eyebrow: string;
  let note: string;
  if (incoming && !countered) {
    eyebrow = `Offer from ${counterpartyName}${what}`;
    note = expires ? `Answer ${expires}.` : "Your move.";
  } else if (incoming) {
    eyebrow = `You countered${what}`;
    note = `Waiting on ${counterpartyName} to take your ${formatPrice(counterAmountCents!)} counter or walk away.`;
  } else if (countered) {
    eyebrow = `${counterpartyName} countered${what}`;
    note = `You offered ${formatPrice(amountCents)}.${expires ? ` Decide ${expires}.` : ""}${
      buyerOffersLeft != null ? ` ${buyerOffersLeft === 0 ? "No offers left to counter with" : `${buyerOffersLeft} of 3 offers left`}.` : ""
    }`;
  } else {
    eyebrow = `Your offer${what}`;
    note = `Waiting on ${counterpartyName}.${expires ? ` It expires ${expires}.` : ""}`;
  }

  function post(action: (data: FormData) => void, fields: Record<string, string>) {
    const data = new FormData();
    data.set("offer_id", offerId);
    data.set("round", String(round));
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    action(data);
  }

  return (
    <OfferCard eyebrow={eyebrow} amount={formatPrice(live)} note={note} move={move} block={block}>
      <div className="flex flex-wrap gap-2">
        {incoming && !countered && (
          <>
            <Button variant="live" loading={responding} pendingLabel="Accepting…" onClick={() => post(respond, { decision: "accepted" })}>
              Accept {formatPrice(amountCents)}
            </Button>
            <Button variant="ghost" aria-expanded={showCounter} onClick={() => setShowCounter((v) => !v)}>
              Counter
            </Button>
          </>
        )}
        {incoming && (
          <Button variant="ghost" loading={responding} pendingLabel="Passing…" onClick={() => post(respond, { decision: "declined" })}>
            Pass
          </Button>
        )}
        {!incoming && countered && (
          <>
            <Button variant="live" loading={takingCounter} pendingLabel="Confirming…" onClick={() => post(takeCounter, {})}>
              Accept {formatPrice(counterAmountCents!)}
            </Button>
            {buyerOffersLeft !== 0 && (
              <Button variant="ghost" aria-expanded={showCounter} onClick={() => setShowCounter((v) => !v)}>
                Counter back
              </Button>
            )}
          </>
        )}
        {!incoming && (
          <Button variant="quiet" loading={withdrawing} pendingLabel="Withdrawing…" onClick={() => post(withdraw, {})}>
            Withdraw offer
          </Button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {incoming && !countered && showCounter && (
          <motion.form
            key="counter"
            variants={expand}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            className="flex flex-wrap items-end gap-2 overflow-hidden"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              data.set("offer_id", offerId);
              data.set("round", String(round));
              data.set("decision", "countered");
              respond(data);
            }}
          >
            <TextField
              id={counterId}
              label="Your counter"
              name="counter_amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              required
              prefix="$"
              className="min-w-0"
            />
            <Button type="submit" variant="live" loading={responding} pendingLabel="Sending…">
              Send counter
            </Button>
          </motion.form>
        )}
        {!incoming && countered && showCounter && (
          <motion.form
            key="counter-back"
            variants={expand}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            className="flex flex-wrap items-end gap-2 overflow-hidden"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              data.set("offer_id", offerId);
              data.set("round", String(round));
              counterBack(data);
            }}
          >
            <TextField
              id={counterId}
              label="Your counter-offer"
              name="counter_amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              required
              prefix="$"
              hint={`Between ${formatPrice(amountCents)} and ${formatPrice(counterAmountCents!)}.`}
              className="min-w-0"
            />
            <Button type="submit" variant="live" loading={counteringBack} pendingLabel="Sending…">
              Send counter-offer
            </Button>
          </motion.form>
        )}
      </AnimatePresence>

      <ResultNote error={respondState.error} ok={respondState.ok} />
      <ResultNote error={backState.error} ok={backState.ok} />
      <ResultNote error={withdrawState.error} ok={withdrawState.ok} />
      <ResultNote error={counterState.error} ok={counterState.ok} />
    </OfferCard>
  );
}

function expiryLabel(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "within the hour";
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)} days`;
}
