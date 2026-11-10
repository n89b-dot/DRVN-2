import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * OS-W41 (report five #116): the real order-email drain inside the real money
 * pass, with an email provider that never answers. Every money family has
 * finished and been recorded before the first send starts, and the pass ends
 * within the drain's own budget plus one send timeout, not never.
 */

const jobs = vi.hoisted(() => {
  const ok = () => vi.fn<() => Promise<unknown>>(async () => ({ failed: 0 }));
  return {
    expiries: ok(), captures: ok(), transfers: ok(), carry: ok(), transferReconciliation: ok(), refunds: ok(),
    labelVoids: ok(), trackers: ok(), returns: ok(), disputes: ok(), payoutDeadlines: ok(), alerts: ok(), analytics: ok(), receipts: ok(), autoConfirm: ok(),
  };
});
const hang = vi.hoisted(() => ({ sends: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/site", () => ({ siteUrl: () => "https://drvn.example" }));
vi.mock("@/lib/email/send", () => ({
  emailTransport: () => ({ name: "hangs", send: () => { hang.sends += 1; return new Promise<never>(() => {}); } }),
}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/admin/alerts", () => ({ processAlertOutbox: () => jobs.alerts() }));
vi.mock("@/lib/auto-confirm-email", () => ({ processAutoConfirmEmails: () => jobs.autoConfirm() }));
vi.mock("@/features/commerce/returns", () => ({ processReturnTimers: () => jobs.returns() }));
vi.mock("@/lib/payments/capture-reconciliation", () => ({ reconcileCapturedPayments: () => jobs.captures() }));
vi.mock("@/lib/payments/dispute-clocks", () => ({ processDisputeClocks: async () => ({ failed: 0 }) }));
vi.mock("@/lib/payments/dispute-sla", () => ({ processDisputeSla: () => jobs.disputes() }));
vi.mock("@/lib/payments/carry-payout-worker", () => ({ processCarryPayouts: () => jobs.carry() }));
vi.mock("@/lib/payments/payout-deadline", () => ({ processPayoutDeadlines: () => jobs.payoutDeadlines() }));
vi.mock("@/lib/payments/refunds", () => ({ resumeIncompleteRefunds: () => jobs.refunds() }));
vi.mock("@/lib/payments/reservation-expiry", () => ({ processReservationExpiries: () => jobs.expiries() }));
vi.mock("@/lib/payments/transfer-worker", () => ({
  processDueTransfers: () => jobs.transfers(),
  reconcileTransferRecords: () => jobs.transferReconciliation(),
}));
vi.mock("@/lib/purchase-analytics", () => ({ processPurchaseAnalytics: () => jobs.analytics() }));
vi.mock("@/lib/receipt-worker", () => ({ processReceiptJobs: () => jobs.receipts() }));
vi.mock("@/lib/shipping/outbound-label-void", () => ({ reconcileOutboundLabelVoids: () => jobs.labelVoids() }));
vi.mock("@/lib/shipping/tracker-registration", () => ({ processTrackerRegistrations: () => jobs.trackers() }));


import { JOB_INVENTORY } from "@/lib/job-inventory";

import { ORDER_EMAIL_BUDGET_MS, ORDER_EMAIL_SEND_TIMEOUT_MS } from "./order-emails";
import { runMoneyWorkerPass } from "./money-worker";

const ORDER = "a1b2c3d4-0000-4000-8000-000000000001";
const events: string[] = [];
const outbox = Array.from({ length: 6 }, (_, i) => ({
  id: `row-${i}`, attempt: 1, recipient_id: "seller", order_id: ORDER, kind: "order_sold", email: "s@drvn.test", guest: false, notification_prefs: {},
}));
const admin = {
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "record_worker_run") { events.push(`${args.p_family}:${args.p_status}`); return { error: null }; }
    if (name === "claim_order_emails") { events.push("claim"); return { data: outbox.splice(0, Number(args.p_limit)), error: null }; }
    if (name === "complete_order_email") { events.push(`complete:${args.p_outcome}`); return { data: "pending", error: null }; }
    throw new Error(`unexpected ${name}`);
  }),
  from: (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) builder[m] = () => builder;
    builder.maybeSingle = async () => ({ data: { id: ORDER, total_cents: 1000, currency: "USD", dispatch_by: null, carrier: null, tracking_number: null, cancel_reason: null }, error: null });
    builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: table === "order_items" ? [{ title: "Turbo" }] : [], error: null });
    return builder;
  },
} as never;

afterEach(() => vi.useRealTimers());

describe("a hanging email provider never slows money (OS-W41, report five #116)", () => {
  it("every money family is recorded before the first send, and the pass ends within the email budget", async () => {
    vi.useFakeTimers();
    const started = Date.now();
    let done = false;
    const pass = runMoneyWorkerPass(admin).then((result) => { done = true; return result; });
    await vi.advanceTimersByTimeAsync(ORDER_EMAIL_BUDGET_MS + ORDER_EMAIL_SEND_TIMEOUT_MS + 1);
    expect(done).toBe(true);
    const result = await pass;
    expect(Date.now() - started).toBeLessThanOrEqual(ORDER_EMAIL_BUDGET_MS + ORDER_EMAIL_SEND_TIMEOUT_MS + 1);

    const firstClaim = events.indexOf("claim");
    const moneyFinished = events.filter((e) => /:(succeeded|failed)$/.test(e) && !e.startsWith("orderEmails"));
    const moneyFamilies = JOB_INVENTORY.find((job) => job.job === "drvn-transfer-worker")!.families.filter((f) => f !== "orderEmails");
    expect(moneyFinished.map((e) => e.split(":")[0]).sort()).toEqual([...moneyFamilies].sort());
    for (const e of moneyFinished) expect(events.indexOf(e)).toBeLessThan(firstClaim);
    expect(moneyFinished.filter((e) => !e.endsWith(":succeeded"))).toEqual([]);

    // Each hung send was given up after its timeout and put back for later;
    // what the budget didn't reach was never claimed.
    expect(hang.sends).toBeGreaterThan(0);
    expect(events.filter((e) => e === "complete:retry")).toHaveLength(hang.sends);
    expect(outbox.length).toBeGreaterThan(0);
    expect(events.at(-1)).toBe("orderEmails:failed");
    expect(result.failed).toBe(true);
  });
});
