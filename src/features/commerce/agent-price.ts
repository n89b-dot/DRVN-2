/**
 * Who set the price on an order that came from an offer (PRD AG-4, readiness
 * 65): the checkout says so when an agent did. Worked out from the offer's
 * recorded rounds (offer_rounds, 20261017150000): a round an agent made
 * carries `actor_task_id` and the `mandate_version` it acted under (A2,
 * 20261021100000; a person's move has neither), and `actor_role` says whose
 * agent — the viewer can't read the other side's agent_tasks, so the side
 * never comes from a join. `actor_task_id` clears when the task is deleted
 * (account deletion, retention); `mandate_version` has no foreign key and
 * stays, so either one marks the round as the agent's. The buyer pays, so
 * the line is written to the buyer.
 *
 * - The buyer's agent accepted the seller's counter: the price is the one it
 *   accepted, within the max the buyer set — "Price set by your agent".
 * - A person accepted, but the amount they accepted was the seller's agent's
 *   counter — "Price agreed with the seller's agent".
 * - Both agents, one accepting the other's counter: the buyer's own agent is
 *   the one that bound them, so it is the one named.
 * - No agent on the round that settled it, or no settling round: nothing.
 */

export type PriceRound = {
  round_no: number;
  actor_role: "buyer" | "seller" | "system";
  kind: "offer" | "counter" | "accept" | "decline" | "withdraw" | "expire" | "below_minimum";
  amount_cents?: number | null;
  created_at: string;
  actor_task_id?: string | null;
  mandate_version?: number | null;
};

/** The columns agentPriceLine needs, for every read that feeds it. */
export const PRICE_ROUND_COLUMNS = "round_no, actor_role, kind, amount_cents, created_at, actor_task_id, mandate_version";

/** An agent made this move: its task, or the mandate version it acted under. */
function byAgent(round: PriceRound): boolean {
  return Boolean(round.actor_task_id) || round.mandate_version != null;
}

export type AgentPriceLine = {
  /** Whose agent fixed the price. */
  by: "your_agent" | "sellers_agent";
  /** When that happened (the accepting round for the buyer's agent, the final counter for the seller's). */
  at: string;
  text: string;
};

const DAY = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** For the buyer's checkout: `rounds` are every round of the order's origin offer. */
export function agentPriceLine(rounds: readonly PriceRound[]): AgentPriceLine | null {
  const ordered = [...rounds].sort((a, b) => a.round_no - b.round_no);
  const accept = [...ordered].reverse().find((round) => round.kind === "accept");
  if (!accept) return null;

  if (accept.actor_role === "buyer" && byAgent(accept)) {
    return { by: "your_agent", at: accept.created_at, text: `Price set by your agent on ${DAY(accept.created_at)}, within the max you set.` };
  }
  // The amount accepted is the last priced move before the acceptance; the
  // seller's agent set it when that move was its counter.
  const priced = ordered.filter((round) => round.round_no < accept.round_no && round.amount_cents != null && round.kind !== "below_minimum").at(-1);
  if (priced && priced.actor_role === "seller" && priced.kind === "counter" && byAgent(priced)) {
    return { by: "sellers_agent", at: priced.created_at, text: `Price agreed with the seller's agent on ${DAY(priced.created_at)}.` };
  }
  return null;
}
