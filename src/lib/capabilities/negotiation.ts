import { z } from "zod";

import { defineCapability, type MemberClient } from "./types";

/**
 * Negotiation as capabilities (A1's offer_move, A2's mandates). These are the
 * member's own moves through their own client: R4 for a move (money), R3 for
 * setting the agent's limits. The model never gets either (it is held to R1);
 * the offline agent makes its moves through agent_offer_move instead.
 */

export type OfferMoveKind = "counter" | "accept" | "decline" | "withdraw";
export type OfferMoveResult = { offer_id: string; round_no: number; kind: string; outcome?: string; replayed?: boolean; order_id?: string | null };

/**
 * One negotiation move through offer_move (20261017160000), as the signed-in
 * member: the database checks turn, round, bounds and limits in one
 * transaction. The idempotency key is the offer, the round the move was made
 * at, the move and its amount, so a form resent after a lost response replays
 * the move it already made — and a different amount at a round that has
 * moved on is refused as stale rather than applied twice. The agent's worker
 * builds the same key.
 */
export async function offerMoveCore(
  supabase: MemberClient,
  move: { offerId: string; kind: OfferMoveKind; round: number; amountCents?: number },
) {
  const { data, error } = await supabase.rpc("offer_move", {
    p_offer: move.offerId,
    p_kind: move.kind,
    // Only a counter carries an amount; the generated type can't say a
    // plpgsql argument may be null.
    p_amount: (move.amountCents ?? null) as number,
    p_idempotency_key: offerMoveKey(move),
    p_expected_round: move.round,
  });
  return { result: data as OfferMoveResult | null, error };
}

export function offerMoveKey(move: { offerId: string; kind: OfferMoveKind; round: number; amountCents?: number | null }) {
  return `${move.kind}:${move.offerId}:r${move.round}:${move.amountCents ?? 0}`;
}

export const moveOffer = defineCapability({
  name: "move_offer",
  description: "Counter, accept, decline or withdraw on an offer the member is party to, at the round they saw.",
  risk: "R4",
  scopes: ["seller", "buyer"],
  input: z.object({
    offerId: z.uuid(),
    kind: z.enum(["counter", "accept", "decline", "withdraw"]),
    round: z.number().int().nonnegative(),
    amountCents: z.number().int().positive().optional(),
  }).refine((move) => (move.kind === "counter") === (move.amountCents !== undefined), "A counter needs an amount, and only a counter"),
  output: z.object({ ok: z.boolean(), code: z.string().nullable(), roundNo: z.number().int().nullable(), orderId: z.string().nullable() }),
  async run({ supabase }, input) {
    const { result, error } = await offerMoveCore(supabase, input);
    return { ok: !error, code: error?.code ?? null, roundNo: result?.round_no ?? null, orderId: result?.order_id ?? null };
  },
});

export const setAgentLimits = defineCapability({
  name: "set_agent_limits",
  description: "Set the member's agent limits on one listing: as seller a minimum (only ever stricter than the listing's), target and style; as buyer a ceiling on the item or item + shipping.",
  risk: "R3",
  scopes: ["seller", "buyer"],
  input: z.object({
    scope: z.enum(["seller", "buyer"]),
    listingId: z.uuid(),
    minimumCents: z.number().int().positive().optional(),
    targetCents: z.number().int().positive().optional(),
    ceilingCents: z.number().int().positive().optional(),
    ceilingBasis: z.enum(["item", "total"]).optional(),
    style: z.enum(["firm", "balanced", "flexible"]).default("balanced"),
    acknowledgeBinding: z.boolean().default(false),
  }),
  output: z.object({ ok: z.boolean(), mandateId: z.string().nullable(), code: z.string().nullable() }),
  async run({ supabase }, input) {
    const { data, error } = await supabase.rpc("agent_mandate_set", {
      p_scope: input.scope,
      p_listing: input.listingId,
      p_minimum_cents: input.minimumCents,
      p_target_cents: input.targetCents,
      p_ceiling_cents: input.ceilingCents,
      p_ceiling_basis: input.ceilingBasis,
      p_style: input.style,
      p_acknowledge_binding: input.acknowledgeBinding,
    });
    return { ok: !error, mandateId: (data as string | null) ?? null, code: error?.code ?? null };
  },
});
