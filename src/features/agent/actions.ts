"use server";

import { redirect } from "next/navigation";

import { agentStepOpen, agentTabOpen } from "@/lib/agent/beta";
import { memberContext } from "@/lib/agent/context";
import { loadAgentMode } from "@/lib/agent/member-mode";
import { agentModeAllowsMandates, agentModeRefusal } from "@/lib/agent/mode";
import { setAgentLimits } from "@/lib/capabilities/negotiation";
import { CapabilityError, invokeCapability } from "@/lib/capabilities/types";
import { capture } from "@/lib/analytics";
import { reportError } from "@/lib/monitoring";
import { PAYOUTS_NOT_READY_CODE } from "@/lib/payments/payout-readiness";
import { revalidatePath } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";

export type AgentState = {
  error?: string;
  ok?: string;
  /** The limits were saved but the paused agent couldn't be resumed (readiness 71). */
  stillPaused?: boolean;
};

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
    case "AG009":
      // The database's own check on the member's agent setting (R-agentmode).
      return "Your agent is set to Off or Suggest in Settings, so it can't negotiate for you.";
    case PAYOUTS_NOT_READY_CODE:
      // Accepting reserves the part; the database refuses while the seller's
      // payouts are off (20261107210000, N244).
      return "This sale can't go ahead until the seller's payouts are set up.";
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
  const { supabase, user } = await requireUser();
  if (!(await agentTabOpen())) return { error: "The agent isn't available yet." };
  const approvalId = String(formData.get("approval_id") ?? "");
  const choice = String(formData.get("choice") ?? "");
  if (!approvalId || (choice !== "accept" && choice !== "dismiss")) return { error: "Missing choice." };

  const { error } = await supabase.rpc("agent_approval_decide", { p_approval: approvalId, p_choice: choice });
  if (!error) capture(user.id, { event: "agent_approval_answered", props: { choice } });
  if (error) {
    reportError("[agent] approval decision failed", { approvalId, choice, code: error.code });
    return { error: agentError(error.code, "Couldn't record that. Try again.") };
  }
  revalidatePath("/agent");
  if (choice === "accept") {
    // The row leaves Needs you once it's decided, so the answer is the offer
    // itself: accepted, the order, and Cancel before checkout.
    const { data: approval } = await supabase.from("agent_approvals").select("offer_id").eq("id", approvalId).maybeSingle();
    if (approval?.offer_id) {
      revalidatePath(`/offers/${approval.offer_id}`);
      redirect(`/offers/${approval.offer_id}`);
    }
    return { ok: "Accepted. The buyer has 24 hours to pay." };
  }
  // agent_approval_decide('dismiss') puts the task back to waiting_for_event
  // and queues nothing: the agent moves again only when the other side does.
  return { ok: "Dismissed. Your agent waits for the next move on this offer." };
}

/**
 * AG-7: a mandate can only be started while the member's agent is set to
 * Act within my limits. The refusal names the setting, so the member knows
 * where to change it.
 */
async function mandateRefusal(userId: string): Promise<string | null> {
  const mode = await loadAgentMode(userId);
  return agentModeAllowsMandates(mode) ? null : agentModeRefusal(mode);
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
  if (!(await agentStepOpen("seller"))) return {};

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
    capture(user.id, { event: "agent_offers_disabled" });
    return { ok: "Your agent stopped handling offers on this listing." };
  }

  const refused = await mandateRefusal(user.id);
  if (refused) return { error: refused };
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
    // Readiness 71: resuming is its own write, and the database can refuse it
    // (a suspended account, a mandate that ended meanwhile). The limits are
    // saved either way; the agent handles offers only once it says 'active'.
    const { data: status, error } = await supabase.rpc("agent_mandate_set_status", { p_mandate: live.id, p_status: "active" });
    if (error || status !== "active") {
      reportError("[agent] resume refused", { listingId: input.listingId, mandateId: live.id, code: error?.code ?? null, status: status ?? null });
      revalidatePath("/agent");
      return {
        error: `Your agent's limits are saved, but it is still paused and isn't handling offers. ${agentError(error?.code, "Couldn't resume it. Try again.")}`,
        stillPaused: true,
      };
    }
  }
  revalidatePath("/agent");
  capture(user.id, { event: "agent_offers_enabled", props: { style: input.style, has_target: input.targetCents != null } });
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
  if (!(await agentStepOpen("buyer"))) return { error: "The agent isn't available yet." };
  const refused = await mandateRefusal(user.id);
  if (refused) return { error: refused };
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
  capture(user.id, { event: "negotiate_for_me_started", props: { basis: input.ceilingBasis, style: input.style } });
  return { ok: "Your agent is negotiating. It tells you when there's a deal, and you pay within 24 hours." };
}

/**
 * "Stop negotiating for me" (readiness 64): the buyer ends their own agent on
 * one listing. 'revoked' is the status a member may set that means ended for
 * good (agent_mandate_set_status accepts active, paused, revoked; 'ended' is
 * the system's). The function cancels the open task and dismisses any
 * pending card in the same transaction; offers already made stay as they
 * are — an offer is the buyer's whether a person or their agent sent it.
 */
export async function stopBuyerAgent(_prev: AgentState, formData: FormData): Promise<AgentState> {
  const { supabase, user } = await requireUser();
  const mandateId = String(formData.get("mandate_id") ?? "");
  if (!mandateId) return { error: "Missing mandate." };

  // Owner-only RLS: another member's mandate simply isn't there.
  const { data: mandate, error: readError } = await supabase
    .from("agent_mandates")
    .select("id, listing_id, scope, status")
    .eq("id", mandateId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (readError) {
    reportError("[agent] stop: mandate unreadable", { mandateId, code: readError.code });
    return { error: "Couldn't check your agent just now. Try again." };
  }
  if (!mandate || mandate.scope !== "buyer") return { error: agentError("P0002", "That's no longer there. Reload the page.") };
  if (mandate.status === "revoked" || mandate.status === "ended") return { ok: "Your agent has already stopped on this part." };

  const { data: status, error } = await supabase.rpc("agent_mandate_set_status", { p_mandate: mandate.id, p_status: "revoked" });
  if (error || status !== "revoked") {
    reportError("[agent] stop buyer agent failed", { mandateId, code: error?.code ?? null, status: status ?? null });
    return { error: agentError(error?.code, "Couldn't stop your agent. Try again.") };
  }
  capture(user.id, { event: "negotiate_for_me_stopped" });
  revalidatePath("/agent");
  revalidatePath(`/listings/${mandate.listing_id}`);
  const offerId = String(formData.get("offer_id") ?? "");
  if (offerId) revalidatePath(`/offers/${offerId}`);
  return { ok: "Stopped. Your agent makes no more moves on this part; any offer it already sent stands until it expires." };
}
