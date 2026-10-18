/**
 * The agent worker's pass (A2). It runs as the agent_worker database role and
 * nothing else: it claims leased jobs, reads the owner's view of each one,
 * lets negotiate() choose, and makes exactly the one agent_* call the job
 * allows. Every refusal comes back from the database with a code, and the job
 * is handed back with that code so monitoring sees it (permission denials,
 * kill switches, stale rounds). It never connects as the service role and
 * never calls a server action.
 *
 * `db` is anything with pg's query shape, so the operations drill can drive
 * the same code over a SET ROLE connection.
 */

import { negotiate, type Decision, type NegotiationInput, type OfferState, type RoundView } from "./negotiate";

export type AgentDb = {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
};

type ClaimedJob = {
  job_id: string;
  lease_id: string;
  task_id: string;
  kind: "offer_turn" | "offer_open";
  expected_action: "offer_move" | "offer_open";
  listing_id: string;
  offer_id: string | null;
  round_no: number | null;
};

/** What agent_job_context returns (20261021100100). */
export type JobContext = {
  job: { id: string; kind: string; expected_action: string; offer_id: string | null; round_no: number | null };
  task: { id: string; scope: "seller" | "buyer"; status: string };
  mandate: { id: string; version: number; status: string; style: "firm" | "balanced" | "flexible"; target_cents: number | null; ceiling_cents: number | null; ceiling_basis: "item" | "total" | null };
  effective_floor_cents: number | null;
  listing: { id: string; status: string; price_cents: number; shipping_cents: number; shipping_mode: string };
  offer: null | { id: string; status: OfferState["status"]; amount_cents: number; counter_amount_cents: number | null; round_count: number; expires_at: string | null };
  rounds: { round_no: number; actor_role: RoundView["actorRole"]; kind: string; amount_cents: number | null; by_agent: boolean }[];
  buyer_amounts: number[];
  halted: string | null;
};

export type PassResult = {
  claimed: number;
  moved: number;
  approvals: number;
  held: number;
  handedBack: number;
  codes: Record<string, number>;
};

/** The worker's view of the job, as negotiate() takes it. */
export function negotiationInput(context: JobContext, now = Date.now()): NegotiationInput {
  return {
    scope: context.task.scope,
    style: context.mandate.style,
    listing: { priceCents: context.listing.price_cents, shippingCents: context.listing.shipping_cents, status: context.listing.status },
    limits: context.task.scope === "seller"
      ? { floorCents: context.effective_floor_cents, targetCents: context.mandate.target_cents }
      : { ceilingCents: context.mandate.ceiling_cents, ceilingBasis: context.mandate.ceiling_basis, targetCents: context.mandate.target_cents },
    offer: context.offer
      ? {
          status: context.offer.status,
          amountCents: context.offer.amount_cents,
          counterAmountCents: context.offer.counter_amount_cents,
          roundCount: context.offer.round_count,
          expiresAt: context.offer.expires_at,
        }
      : null,
    rounds: context.rounds.map((r) => ({ roundNo: r.round_no, actorRole: r.actor_role, kind: r.kind, amountCents: r.amount_cents })),
    buyerAmounts: context.buyer_amounts,
    now,
  };
}

/**
 * How a refused call is handed back: retried later (a kill switch, a rate
 * limit, a lost connection), cancelled (the owner turned it off, the turn
 * moved on) or failed (the listing or offer is gone, which ends the task).
 */
export function handBack(code: string | undefined): { outcome: "retry" | "failed" | "cancelled"; endTask: boolean } | null {
  switch (code) {
    case "AG001":
      return null; // the lease is gone: someone else owns the job now
    case "AG004": case "OF009": case "40001": case "40P01": case "57014":
      return { outcome: "retry", endTask: false };
    case "AG003": case "OF003": case "OF002":
      return { outcome: "cancelled", endTask: false };
    case "OF005": case "OF007": case "OF001":
      return { outcome: "failed", endTask: true };
    case "AG002": case "AG005": case "AG006": case "AG007": case "AG008": case "OF004": case "42501": case "22023":
      return { outcome: "failed", endTask: false };
    default:
      return { outcome: "retry", endTask: false };
  }
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

async function act(db: AgentDb, job: ClaimedJob, context: JobContext, decision: Decision): Promise<"moved" | "approval" | "held"> {
  const offer = context.offer;
  switch (decision.action) {
    case "counter":
    case "accept":
      await db.query("select public.agent_offer_move($1, $2, $3, $4, $5, $6) as result", [
        job.job_id, job.lease_id, job.offer_id, decision.action, decision.action === "counter" ? decision.amountCents : null, job.round_no,
      ]);
      return "moved";
    case "open":
      await db.query("select public.agent_offer_open($1, $2, $3, $4) as result", [job.job_id, job.lease_id, job.listing_id, decision.amountCents]);
      return "moved";
    case "request_approval":
      if (!offer) throw Object.assign(new Error("No offer to approve"), { code: "AG002" });
      await db.query("select public.agent_request_approval($1, $2, $3, $4, $5) as result", [job.job_id, job.lease_id, job.offer_id, job.round_no, decision.reason]);
      return "approval";
    case "hold":
      await db.query("select public.agent_record_decision($1, $2, $3, $4)", [
        job.job_id, job.lease_id, decision.reason === "at_limit" ? "at_limit" : "hold", decision.reason,
      ]);
      return "held";
  }
}

/** One pass: claim up to `limit` jobs and run each once. */
export async function runAgentPass(db: AgentDb, options: { limit?: number; leaseSeconds?: number; now?: () => number } = {}): Promise<PassResult> {
  const result: PassResult = { claimed: 0, moved: 0, approvals: 0, held: 0, handedBack: 0, codes: {} };
  const claimed = await db.query<ClaimedJob>("select * from public.agent_claim_jobs($1, $2)", [options.limit ?? 5, options.leaseSeconds ?? 60]);
  for (const job of claimed.rows) {
    result.claimed++;
    try {
      const contextRow = await db.query<{ context: JobContext }>("select public.agent_job_context($1, $2) as context", [job.job_id, job.lease_id]);
      const context = contextRow.rows[0].context;
      if (context.halted) throw Object.assign(new Error("Paused"), { code: "AG004" });
      const decision = negotiate(negotiationInput(context, options.now?.() ?? Date.now()));
      const done = await act(db, job, context, decision);
      if (done === "moved") result.moved++;
      else if (done === "approval") result.approvals++;
      else result.held++;
    } catch (error) {
      const code = errorCode(error) ?? "XX000";
      result.codes[code] = (result.codes[code] ?? 0) + 1;
      const back = handBack(code);
      if (!back) continue;
      await db.query("select public.agent_finish_job($1, $2, $3, $4, $5)", [job.job_id, job.lease_id, back.outcome, code, back.endTask]);
      result.handedBack++;
    }
  }
  return result;
}
