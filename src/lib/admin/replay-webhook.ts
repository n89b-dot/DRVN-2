import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { dispatchStripeEvent } from "@/lib/payments/settlement";
import { dispatchEasyPostEvent } from "@/lib/shipping/webhook";

/** The durable row identity chooses the provider; untrusted payloads cannot. */
export async function dispatchRecordedWebhookEvent(
  admin: ReturnType<typeof createAdminClient>,
  recordedId: string,
  payload: unknown
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid stored webhook payload");
  }
  const event = payload as Record<string, unknown>;
  if (recordedId.startsWith("easypost:")) {
    if (recordedId !== `easypost:${event.id}`) throw new Error("Stored shipping event identity mismatch");
    return dispatchEasyPostEvent(admin, payload);
  }
  if (!recordedId.startsWith("evt_") || event.id !== recordedId || typeof event.type !== "string") {
    throw new Error("Stored Stripe event identity mismatch");
  }
  return dispatchStripeEvent(admin, payload as Stripe.Event);
}
