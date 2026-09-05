import "server-only";
import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
export class CaptureMismatch extends Error {}
export async function recordCaptureRecovery(admin: ReturnType<typeof createAdminClient>, identity: string, reason: string, amount?: number) {
  const result = await admin.rpc("record_capture_recovery", { p_key: identity, p_detail: reason, p_amount: amount });
  if (result.error) throw new Error("Capture recovery could not be persisted; retry required");
}
export function matchesPaymentRequest(intent: Stripe.PaymentIntent, request: { orderIds: string[]; buyerId: string; totalCents: number; currency: string }) {
  return intent.amount === request.totalCents && intent.currency.toLowerCase() === request.currency.toLowerCase() && intent.metadata.buyer_id === request.buyerId &&
    [...request.orderIds].sort().join(",") === (intent.metadata.order_id || "").split(",").sort().join(",");
}
