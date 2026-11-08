import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R-audit-closecase: closing a recovery case records a money outcome, so it
 * has no preselected answer. The form starts on a blank, unsubmittable
 * choice, and the server refuses a close without an explicit outcome.
 */

const mocks = vi.hoisted(() => ({
  dialogs: [] as { title: string; fields: { kind: string; name?: string; placeholder?: string; options?: { value: string }[] }[] }[],
  context: vi.fn(),
  audited: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("next/link", () => ({ default: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock("@/lib/admin/queries", () => ({
  getPaymentsOps: async () => ({
    recoveries: [{ id: "rec-1", kind: "reversal_failed", status: "open", order_id: null, amount_cents: 2500, detail: null, created_at: "2026-11-01T00:00:00Z", last_seen_at: "2026-11-01T00:00:00Z", orderTitle: "Order" }],
    stuckIntents: [], stuckCarryPayouts: [], refundOps: [], alertBacklog: [], recentEvents: [],
  }),
}));
vi.mock("../_components/action-dialog", () => ({
  ActionDialog: (props: (typeof mocks.dialogs)[number]) => {
    mocks.dialogs.push(props);
    return null;
  },
}));
vi.mock("../_components/payload-viewer", () => ({ PayloadViewer: () => null }));

// The server action, with its collaborators stubbed.
vi.mock("@/lib/admin/guard", () => ({ getAdminContext: mocks.context }));
vi.mock("@/lib/admin/audit", () => ({ auditedAction: mocks.audited, RefusedOperationError: class extends Error {} }));
vi.mock("@/lib/payments/late-refund-recovery", () => ({ verifyLateRefundRecovery: mocks.verify }));
vi.mock("@/lib/revalidate", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/money-worker", () => ({ runMoneyWorkerPass: vi.fn() }));
vi.mock("@/lib/payments/refunds", () => ({ refundOrder: vi.fn() }));
vi.mock("@/lib/payments/settlement", () => ({ markWebhookEventProcessed: vi.fn() }));
vi.mock("@/lib/payments/webhook-failures", () => ({ recordWebhookFailure: vi.fn() }));
vi.mock("@/lib/admin/replay-webhook", () => ({ dispatchRecordedWebhookEvent: vi.fn() }));
vi.mock("@/lib/admin/alerts", () => ({ sendAdminAlert: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { default: AdminPaymentsPage } = await import("./page");
const { adminResolveRecovery } = await import("@/lib/admin/actions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  mocks.dialogs = [];
  mocks.context.mockResolvedValue({ userId: "admin-1", role: "admin" });
  mocks.audited.mockReset().mockResolvedValue({});
  mocks.verify.mockReset().mockResolvedValue(undefined);
});

describe("Close case (R-audit-closecase)", () => {
  it("offers Recovered and Written off with neither chosen", async () => {
    renderToStaticMarkup(await AdminPaymentsPage({ searchParams: Promise.resolve({}) }));
    const close = mocks.dialogs.find((d) => d.title === "Close recovery case");
    const outcome = close?.fields.find((f) => f.name === "outcome");
    expect(outcome).toMatchObject({ kind: "select", placeholder: "Choose an outcome" });
    expect(outcome?.options?.map((o) => o.value)).toEqual(["recovered", "written_off"]);
  });

  it.each([[""], ["   "], ["recoverd"], ["open"]])("the server refuses a close with outcome %j", async (outcome) => {
    const result = await adminResolveRecovery(null, form({ recovery_id: "rec-1", outcome, note: "Seller repaid" }));
    expect(result).toEqual({ error: "Pick an outcome." });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.audited).not.toHaveBeenCalled();
  });

  it("the server refuses a close with no outcome field at all", async () => {
    const result = await adminResolveRecovery(null, form({ recovery_id: "rec-1", note: "Seller repaid" }));
    expect(result).toEqual({ error: "Pick an outcome." });
    expect(mocks.audited).not.toHaveBeenCalled();
  });

  it("records the outcome the operator chose", async () => {
    const result = await adminResolveRecovery(null, form({ recovery_id: "rec-1", outcome: "written_off", note: "Absorbed" }));
    expect(result).toEqual({ ok: "Recovery case closed." });
    expect(mocks.audited.mock.calls[0][1]).toMatchObject({ action: "recovery.written_off", subjectId: "rec-1" });
  });
});
