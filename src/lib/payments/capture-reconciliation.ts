import "server-only";
import { mapBounded } from "@/lib/map-bounded";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeClient } from "./stripe";
import { settleIntent } from "./settlement";
import { getPaymentProvider } from "./provider";
import { CaptureMismatch, matchesPaymentRequest, recordCaptureRecovery } from "./capture-recovery";

export async function reconcileCapturedPayments() {
  if (getPaymentProvider().name !== "stripe") return { checked: 0, failed: 0 };
  const admin = createAdminClient(), stripe = stripeClient();
  let checked = 0, failed = 0;
  const unmapped = await admin.rpc("claim_unmapped_payment_requests", {});
  if (unmapped.error) throw new Error("Unmapped payment claim failed");
  type Request = { operation_key: string; correlation_id: string; request: { orderIds: string[]; buyerId: string; totalCents: number; currency: string } };
  await mapBounded((unmapped.data ?? []) as unknown as Request[], 4, async (saved) => {
    try {
      // Search is eventually consistent. Absence is never permission to charge again.
      const matches = await stripe.paymentIntents.search({ query: `metadata['correlation_id']:'${saved.correlation_id}'`, limit: 2 }, { timeout: 3000, maxNetworkRetries: 0 });
      if (matches.has_more || matches.data.length !== 1 || !matchesPaymentRequest(matches.data[0], saved.request)) {
        await recordCaptureRecovery(admin, `request:${saved.operation_key}`, "Provider mapping unresolved; inspect persisted request and correlation before any new charge");
        failed++; return;
      }
      const recorded = await admin.rpc("record_payment_reference", { p_key: saved.operation_key, p_reference: matches.data[0].id });
      if (recorded.error) throw new CaptureMismatch("Recovered reference conflicts with local ledger");
      checked++;
    } catch {
      failed++;
      await recordCaptureRecovery(admin, `request:${saved.operation_key}`, "Provider lookup or mapping failed; reservation remains unresolved");
    }
  });
  const { data, error } = await admin.rpc("capture_reconciliation_candidates", {});
  if (error) throw new Error("Capture reconciliation lookup failed");
  await mapBounded((data || []) as string[], 8, async (reference) => {
    try {
      const intent = await stripe.paymentIntents.retrieve(reference, {}, { timeout: 3000, maxNetworkRetries: 0 });
      checked++;
      if (intent.status === "succeeded") {
        if (!(await settleIntent(admin, intent, true))) { failed++; return; }
        const done = await admin.rpc("finish_capture_check", { p_reference: reference });
        if (done.error) throw new Error("Reconciliation completion failed");
      } else if (intent.status === "canceled") {
        const done = await admin.rpc("finish_capture_check", { p_reference: reference });
        if (done.error) throw new Error("Reconciliation completion failed");
      }
    } catch (error) {
      failed++;
      if (error instanceof CaptureMismatch) await recordCaptureRecovery(admin, `capture:${reference}`, error.message);
    }
  });
  return { checked, failed };
}
