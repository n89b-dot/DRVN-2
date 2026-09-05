import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeClient } from "./stripe";
import { settleIntent } from "./settlement";
import { getPaymentProvider } from "./provider";
import { reportError } from "@/lib/monitoring";
export async function reconcileCapturedPayments() {
  if (getPaymentProvider().name !== "stripe") return { checked: 0, failed: 0 };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("capture_reconciliation_candidates", {});
  if (error) throw new Error("Capture reconciliation lookup failed");
  let checked = 0, failed = 0;
  for (const reference of (data || []) as string[]) {
    try {
      const intent = await stripeClient().paymentIntents.retrieve(reference);
      checked++;
      if (intent.status === "succeeded" && !(await settleIntent(admin, intent, true))) failed++;
    } catch { failed++; reportError("[capture-reconciliation] provider lookup failed", { reference }); }
  }
  if (failed) throw new Error(`Capture reconciliation failed for ${failed} references`);
  return { checked, failed };
}
