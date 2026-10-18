/**
 * An offer's history, oldest first, from its recorded rounds
 * (offer_rounds, migration 20261017150000). Each round is one move, so the
 * thread reads the negotiation as it happened instead of rebuilding it from
 * the offer row's columns — which can't show more than one counter.
 */

export type OfferRound = {
  round_no: number;
  actor_role: "buyer" | "seller" | "system";
  kind: "offer" | "counter" | "accept" | "decline" | "withdraw" | "expire" | "below_minimum";
  amount_cents: number | null;
  created_at: string;
};

export type OfferHistoryEntry = { label: string; at: string; amount?: number };

/** `incoming`: the viewer is the listing's seller. */
export function offerHistoryFromRounds(
  rounds: OfferRound[],
  { incoming, counterpartyName }: { incoming: boolean; counterpartyName: string },
): OfferHistoryEntry[] {
  return [...rounds]
    .sort((a, b) => a.round_no - b.round_no)
    .map((round) => {
      const mine = round.actor_role === (incoming ? "seller" : "buyer");
      const who = mine ? "You" : counterpartyName;
      const at = round.created_at;
      switch (round.kind) {
        case "offer":
          return { label: `${who} made an offer`, at, amount: round.amount_cents ?? undefined };
        case "counter":
          return { label: `${who} countered`, at, amount: round.amount_cents ?? undefined };
        case "accept":
          // A buyer accepting is always a counter they were sent.
          return { label: round.actor_role === "buyer" ? `${who} accepted the counter` : `${who} accepted`, at };
        case "decline":
          return { label: `${who} declined`, at };
        case "withdraw":
          return { label: `${who} withdrew the offer`, at };
        case "expire":
          return { label: "Offer expired unanswered", at };
        case "below_minimum":
          // The seller learns why; the buyer is never told the minimum.
          return { label: incoming ? "Declined automatically: below your minimum" : "Declined", at, amount: round.amount_cents ?? undefined };
      }
    });
}
