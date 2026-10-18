"use server";

import { redirect } from "next/navigation";

import { agentsBetaOn } from "@/lib/agent/beta";
import { memberContext } from "@/lib/agent/context";
import { setAgentLimits } from "@/lib/capabilities/negotiation";
import { CapabilityError, invokeCapability } from "@/lib/capabilities/types";
import { reportError } from "@/lib/monitoring";
import { revalidatePath } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";

export type AgentState = { error?: string; ok?: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

/** What the owner sees when the database refuses, without its internals. */
function agentError(code: string | undefined, fallback: string): string {
  switch (code) {
    case "42501":
      return "Your account can't do that right now.";
    case "P0002":
      return "That's no longer there. Reload the page.";
    case "OF002":
    case "OF003":
      return "The offer has moved on since your agent asked. Open the offer to see where it stands.";
    case "OF005":
      return "This offer has expired.";
    default:
      return fallback;
  }
}

/**
 * Needs you: accept what the agent recommended, or dismiss it. Accepting is
 * the owner's own move (agent_approval_decide runs it as them), so it makes
 * a sale exactly as tapping Accept on the offer would.
 */
export async function decideAgentApproval(_prev: AgentState, formData: FormData): Promise<AgentState> {
  const { supabase } = await requireUser();
  if (!agentsBetaOn()) return { error: "The agent isn't available yet." };
  const approvalId = String(formData.get("approval_id") ?? "");
  const choice = String(formData.get("choice") ?? "");
  if (!approvalId || (choice !== "accept" && choice !== "dismiss")) return { error: "Missing choice." };

  const { data, error } = await supabase.rpc("agent_approval_decide", { p_approval: approvalId, p_choice: choice });
  if (error) {
    reportError("[agent] approval decision failed", { approvalId, choice, code: error.code });
    return { error: agentError(error.code, "Couldn't record that. Try again.") };
  }
  revalidatePath("/agent");
  const result = (data ?? {}) as { order_id?: string | null; offer_id?: string };
  if (choice === "accept" && result.order_id) {
    revalidatePath(`/offers/${result.offer_id ?? ""}`);
    return { ok: "Accepted. The buyer has 24 hours to pay." };
  }
  return { ok: choice === "accept" ? "Accepted." : "Dismissed. Your agent keeps going within your limits." };
}

/**
 * "Let DRVN handle offers" on one listing: set the seller agent's limits, or
 * turn it off. The minimum here can only make the listing's floor stricter
 * (agent_mandate_set enforces it); the binding acknowledgement is required.
 */
export async function saveListingAgent(input: {
  listingId: string;
  on: boolean;
  minimumCents: number | null;
  targetCents: number | null;
  style: "firm" | "balanced" | "flexible";
  acknowledgeBinding: boolean;
}): Promise<AgentState> {
  const { supabase, user } = await requireUser();
  if (!agentsBetaOn()) return {};

  const { data: live } = await supabase
    .from("agent_mandates")
    .select("id, status")
    .eq("owner_id", user.id)
    .eq("listing_id", input.listingId)
    .eq("scope", "seller")
    .in("status", ["active", "paused"])
    .maybeSingle();

  if (!input.on) {
    if (!live) return {};
    const { error } = await supabase.rpc("agent_mandate_set_status", { p_mandate: live.id, p_status: "revoked" });
    if (error) return { error: agentError(error.code, "Couldn't turn your agent off. Try again.") };
    return { ok: "Your agent stopped handling offers on this listing." };
  }

  if (!input.acknowledgeBinding) return { error: "Confirm that your agent's counters are binding offers to sell." };
  let result: { ok: boolean; code: string | null };
  try {
    result = await invokeCapability(setAgentLimits, { context: memberContext(user.id, "seller"), supabase }, {
      scope: "seller",
      listingId: input.listingId,
      minimumCents: input.minimumCents ?? undefined,
      targetCents: input.targetCents ?? undefined,
      style: input.style,
      acknowledgeBinding: true,
    });
  } catch (error) {
    if (error instanceof CapabilityError) return { error: "Check the minimum and target: both are whole dollar amounts above zero." };
    throw error;
  }
  if (!result.ok) {
    reportError("[agent] mandate set failed", { listingId: input.listingId, code: result.code });
    return { error: agentError(result.code ?? undefined, "Couldn't save your agent's limits. Check the minimum and target.") };
  }
  if (live?.status === "paused") {
    await supabase.rpc("agent_mandate_set_status", { p_mandate: live.id, p_status: "active" });
  }
  revalidatePath("/agent");
  return { ok: "Your agent is handling offers on this listing." };
}

/**
 * "Negotiate for me" (A3b): the buyer's agent on one listing, with a private
 * ceiling on the item or on item + shipping. It opens, counters and accepts
 * within that ceiling; an accepted counter is a purchase the buyer pays for
 * by hand within 24 hours, so the acknowledgement is required. Not offered
 * where the total isn't knowable before checkout (DRVN Shipping).
 */
export async function startBuyerAgent(input: {
  listingId: string;
  ceilingCents: number;
  ceilingBasis: "item" | "total";
  style: "firm" | "balanced" | "flexible";
  acknowledgeBinding: boolean;
}): Promise<AgentState> {
  const { supabase, user } = await requireUser();
  if (!agentsBetaOn()) return { error: "The agent isn't available yet." };
  if (!input.acknowledgeBinding) return { error: "Confirm that an accepted counter is a purchase you'll pay for." };
  if (!Number.isInteger(input.ceilingCents) || input.ceilingCents <= 0) return { error: "Enter the most you'll pay." };

  const { data: listing } = await supabase
    .from("listings")
    .select("id, seller_id, status, shipping_mode, price_cents")
    .eq("id", input.listingId)
    .maybeSingle();
  if (!listing || listing.status !== "active") return { error: "This part isn't for sale right now." };
  if (listing.seller_id === user.id) return { error: "This is your own listing." };
  if (listing.shipping_mode === "drvn") return { error: "Shipping is priced at checkout, so DRVN can't negotiate a total here." };

  let result: { ok: boolean; code: string | null };
  try {
    result = await invokeCapability(setAgentLimits, { context: memberContext(user.id, "buyer"), supabase }, {
      scope: "buyer",
      listingId: input.listingId,
      ceilingCents: input.ceilingCents,
      ceilingBasis: input.ceilingBasis,
      style: input.style,
      acknowledgeBinding: true,
    });
  } catch (error) {
    if (error instanceof CapabilityError) return { error: "Enter your max as a whole dollar amount above zero." };
    throw error;
  }
  if (!result.ok) {
    reportError("[agent] buyer mandate failed", { listingId: input.listingId, code: result.code });
    return { error: agentError(result.code ?? undefined, "Couldn't start your agent. Check your max and try again.") };
  }
  revalidatePath("/agent");
  revalidatePath(`/listings/${input.listingId}`);
  return { ok: "Your agent is negotiating. It tells you when there's a deal, and you pay within 24 hours." };
}
