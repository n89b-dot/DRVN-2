import "server-only";
import { mapBounded } from "@/lib/map-bounded";
import { jobHeartbeat } from "@/lib/job-lease";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeClient } from "./stripe";
import { settleIntent } from "./settlement";
import { clearPublicData } from "@/lib/supabase/clear-public-data";

/** A failed cancellation is never evidence that a charge did not happen. */
export async function resolveExpiryIntent(
  intent: Stripe.PaymentIntent,
  cancel: () => Promise<Stripe.PaymentIntent>,
  settle: (captured: Stripe.PaymentIntent) => Promise<boolean>,
): Promise<"cancelled" | "settled"> {
  if (intent.status === "succeeded") {
    if (!(await settle(intent))) throw new Error("Captured expiry needs settlement retry");
    return "settled";
  }
  if (intent.status === "processing") throw new Error("Payment is processing; retain reservation");
  const terminal = intent.status === "canceled" ? intent : await cancel();
  if (terminal.status !== "canceled") throw new Error("Payment cancellation uncertain; retain reservation");
  return "cancelled";
}

export async function processReservationExpiries() {
  const admin = createAdminClient();
  const queued = await admin.rpc("release_expired_reservations", {});
  if (queued.error) throw new Error("Reservation expiry scheduling failed");
  const claimed = await admin.rpc("claim_remediation_jobs", { p_kind: "reservation_expiry", p_limit: 10 });
  if (claimed.error) throw new Error("Reservation expiry claim failed");
  let completed = 0, failed = 0;
  type Job = { id: string; lease_id: string; payload: { order_id: string } };
  await mapBounded((claimed.data ?? []) as unknown as Job[], 4, async (job) => {
    let failure: string | undefined;
    try {
      await jobHeartbeat(admin, job)();
      const order = await admin.from("orders").select("status,buyer_id").eq("id", job.payload.order_id).maybeSingle();
      if (order.error) throw new Error("Expiry order lookup failed");
      if (order.data && ["pending", "requires_action"].includes(order.data.status)) {
        const payment = await admin.from("payments").select("provider,provider_reference").eq("order_id", job.payload.order_id).single();
        if (payment.error) throw new Error("Expiry payment lookup failed");
        const ref = payment.data.provider_reference;
        let captured = false;
        if (ref) {
          if (payment.data.provider !== "stripe") throw new Error("Unsupported expiry provider; recovery required");
          const stripe = stripeClient();
          const intent = await stripe.paymentIntents.retrieve(ref, {}, { timeout: 3000, maxNetworkRetries: 0 });
          if (intent.metadata.buyer_id !== order.data.buyer_id || !intent.metadata.order_id?.split(",").includes(job.payload.order_id)) {
            throw new Error("Expiry provider ownership mismatch");
          }
          captured = await resolveExpiryIntent(intent,
            () => stripe.paymentIntents.cancel(ref, { cancellation_reason: "abandoned" }, { idempotencyKey: `expiry:${ref}`, timeout: 3000, maxNetworkRetries: 0 }),
            (value) => settleIntent(admin, value, true)) === "settled";
        }
        if (!captured) {
          const expired = await admin.rpc("finish_reservation_expiry", { p_job: job.id, p_lease: job.lease_id, p_reference: ref });
          if (expired.error) throw new Error(`Expiry held for reconciliation: ${expired.error.message}`);
        }
      }
      completed++;
    } catch (error) { failed++; failure = error instanceof Error ? error.message : "Expiry failed"; }
    const finished = await admin.rpc("finish_remediation_job", { p_id: job.id, p_lease: job.lease_id, p_error: failure });
    if (finished.error) throw new Error("Expiry acknowledgement failed");
  });
  // A released reservation puts the part back on sale for everyone.
  if (completed) clearPublicData("listings");
  return { completed, failed };
}
