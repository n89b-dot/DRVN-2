// No "server-only" guard: this module sits in the import graph of
// unit-tested payment code (vitest runs without the RSC condition). It holds
// no secrets beyond reading an env var, and everything importing it is
// already server-only.
import { reportError } from "@/lib/monitoring";

/**
 * Push alerting for the two events an operator must not discover by polling:
 * a dispute crossing its SLA and a recovery case opening. Posts JSON to
 * ADMIN_ALERT_WEBHOOK_URL — the body carries a Slack-compatible `text` plus
 * the structured fields, so a Slack incoming webhook, a Zapier hook, or a
 * bespoke receiver all work unmodified. Unset URL = silent no-op (dev
 * default); delivery failure is reported but NEVER fails the calling
 * mutation — money paths do not depend on the messenger.
 */

export type AdminAlert = {
  kind:
    | "dispute_over_sla"
    | "dispute_auto_refund_failed"
    | "recovery_case_opened"
    | "transfer_stuck";
  title: string;
  detail?: string;
  orderId?: string | null;
  amountCents?: number | null;
};

export async function sendAdminAlert(alert: AdminAlert): Promise<void> {
  const url = process.env.ADMIN_ALERT_WEBHOOK_URL;
  if (!url) return;

  const amount = alert.amountCents != null ? ` · $${(alert.amountCents / 100).toFixed(2)}` : "";
  const order = alert.orderId ? ` · order ${alert.orderId.slice(0, 8)}` : "";
  const text = `[DRVN console] ${alert.title}${amount}${order}${alert.detail ? ` — ${alert.detail}` : ""}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, ...alert }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      reportError("[alerts] webhook rejected delivery", { status: res.status, kind: alert.kind });
    }
  } catch (error) {
    reportError("[alerts] webhook delivery failed", { kind: alert.kind, error });
  }
}
