/**
 * An offer's history, oldest first, from its recorded rounds
 * (offer_rounds, migration 20261017150000). Each round is one move, so the
 * thread reads the negotiation as it happened instead of rebuilding it from
 * the offer row's columns — which can't show more than one counter.
 *
 * Who acted is a role, not a name (A3 design, docs/design/agent-a3 04): You,
 * Your agent, Buyer, Buyer's agent (Seller, Seller's agent from the buyer's
 * side). A round an agent made carries `actor_task_id` (A2, 20261021100100),
 * and says so in a muted "via agent" on its timestamp line. Only the
 * viewer's own agent's rounds get a one-line reason.
 */

export type OfferRound = {
  round_no: number;
  actor_role: "buyer" | "seller" | "system";
  kind: "offer" | "counter" | "accept" | "decline" | "withdraw" | "expire" | "below_minimum";
  amount_cents: number | null;
  created_at: string;
  /** Set when an agent made the move (A2). */
  actor_task_id?: string | null;
};

export type OfferHistoryEntry = {
  label: string;
  at: string;
  amount?: number;
  /** The move was the agent's: shown as "· via agent". */
  viaAgent?: boolean;
  /** Why the viewer's own agent did it. Never shown for the other side. */
  reason?: string;
};

/** The viewer's own agent limits on this listing, for the reasons. */
export type HistoryMandate = {
  minimumCents: number | null;
  targetCents: number | null;
  style: "firm" | "balanced" | "flexible";
};

const BUYER_OFFERS = 3;

const STYLE_STEP: Record<HistoryMandate["style"], string> = {
  firm: "Firm moves a small step each round",
  balanced: "Balanced moves about half the gap each round",
  flexible: "Flexible meets buyers sooner",
};

const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

/**
 * The one line under the seller's own agent's counter. It is worked out from
 * the rounds and the limits the seller set, so it says only what the seller
 * can already see: their own minimum and target, and the buyer's numbers.
 */
function sellerAgentReason(
  round: OfferRound,
  { lastBuyer, lastOwn }: { lastBuyer: number | null; lastOwn: number | null },
  mandate: HistoryMandate,
): string | undefined {
  if (round.kind !== "counter" || round.amount_cents == null) return undefined;
  const amount = round.amount_cents;
  const minimum = mandate.minimumCents;
  if (minimum != null && amount <= minimum) return `Final counter at your ${dollars(minimum)} minimum.`;
  if (lastOwn == null) {
    const opened = mandate.targetCents != null && amount === mandate.targetCents ? `Opened at your ${dollars(amount)} target.` : `Opened at ${dollars(amount)}.`;
    if (lastBuyer == null || minimum == null) return opened;
    const gap = lastBuyer - minimum;
    return `${opened} Their ${dollars(lastBuyer)} is ${dollars(Math.abs(gap))} ${gap >= 0 ? "above" : "below"} your minimum.`;
  }
  return `Gave ground ${dollars(lastOwn - amount)} from ${dollars(lastOwn)}: ${STYLE_STEP[mandate.style]}.`;
}

/** `incoming`: the viewer is the listing's seller. */
export function offerHistoryFromRounds(
  rounds: OfferRound[],
  { incoming, mandate }: { incoming: boolean; mandate?: HistoryMandate | null },
): OfferHistoryEntry[] {
  const viewerRole = incoming ? "seller" : "buyer";
  const otherName = incoming ? "Buyer" : "Seller";
  let buyerOffers = 0;
  let lastBuyer: number | null = null;
  let lastSeller: number | null = null;

  return [...rounds]
    .sort((a, b) => a.round_no - b.round_no)
    .map((round) => {
      const mine = round.actor_role === viewerRole;
      const viaAgent = Boolean(round.actor_task_id);
      const who = mine ? (viaAgent ? "Your agent" : "You") : viaAgent ? `${otherName}'s agent` : otherName;
      const at = round.created_at;
      const amount = round.amount_cents ?? undefined;
      const reason =
        mine && viaAgent && incoming && mandate
          ? sellerAgentReason(round, { lastBuyer, lastOwn: lastSeller }, mandate)
          : undefined;
      if (round.actor_role === "buyer" && ["offer", "counter", "below_minimum"].includes(round.kind)) buyerOffers++;
      // The buyer's last allowed offer says so: there is no fourth.
      const last = round.actor_role === "buyer" && buyerOffers === BUYER_OFFERS ? ` — offer ${BUYER_OFFERS} of ${BUYER_OFFERS}` : "";
      if (round.amount_cents != null && round.kind !== "below_minimum") {
        if (round.actor_role === "buyer") lastBuyer = round.amount_cents;
        if (round.actor_role === "seller") lastSeller = round.amount_cents;
      }

      const entry = (label: string, withAmount = false): OfferHistoryEntry => ({
        label,
        at,
        ...(withAmount && amount !== undefined ? { amount } : {}),
        ...(viaAgent ? { viaAgent } : {}),
        ...(reason ? { reason } : {}),
      });
      switch (round.kind) {
        case "offer":
          return entry(`${who} made an offer${last}`, true);
        case "counter":
          return entry(`${who} countered${last}`, true);
        case "accept":
          // A buyer accepting is always a counter they were sent.
          return entry(round.actor_role === "buyer" ? `${who} accepted the counter` : `${who} accepted`);
        case "decline":
          return entry(`${who} declined`);
        case "withdraw":
          return entry(`${who} withdrew the offer`);
        case "expire":
          return entry("Offer expired unanswered");
        case "below_minimum":
          // The seller learns why; the buyer is never told the minimum.
          return entry(incoming ? "Declined automatically: below your minimum" : "Declined", true);
      }
    });
}
