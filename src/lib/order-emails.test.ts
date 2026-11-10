import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

const { ORDER_EMAIL_SEND_TIMEOUT_MS, processOrderEmails } = await import("./order-emails");

const ORDER = "a1b2c3d4-0000-4000-8000-000000000001";
type Row = { id: string; attempt: number; recipient_id: string; order_id: string; kind: string; email: string; guest: boolean; notification_prefs: unknown };
const row = (over: Partial<Row> = {}): Row => ({ id: "row-1", attempt: 1, recipient_id: "u1", order_id: ORDER, kind: "order_shipped", email: "a@example.test", guest: false, notification_prefs: {}, ...over });

function fakeAdmin(rows: Row[]) {
  const completed: Record<string, unknown>[] = [];
  const queue = [...rows];
  const admin = {
    completed,
    queue,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_order_emails") return { data: queue.splice(0, Number(args.p_limit)), error: null };
      if (name === "complete_order_email") { completed.push(args); return { data: args.p_outcome === "retry" ? "pending" : args.p_outcome, error: null }; }
      if (name === "skip_order_emails_email_off") return { data: 3, error: null };
      throw new Error(`unexpected ${name}`);
    }),
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) builder[m] = () => builder;
      builder.maybeSingle = async () =>
        table === "payout_setup_reminders"
          ? { data: { sale_count: 3 }, error: null }
          : { data: { id: ORDER, total_cents: 1000, currency: "EUR", dispatch_by: null, carrier: "UPS", tracking_number: "1Z", cancel_reason: null }, error: null };
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: table === "order_items" ? [{ title: "Turbo" }] : [], error: null });
      return builder;
    },
  };
  return admin;
}

afterEach(() => vi.useRealTimers());

describe("the order email drain (OS-W41, report five #116)", () => {
  it("with no provider, skips everything waiting as email_off and sends nothing", async () => {
    const admin = fakeAdmin([row()]);
    const tally = await processOrderEmails(admin as never, { transport: null, origin: "https://d.example" });
    expect(tally.skipped).toBe(3);
    expect(admin.rpc).not.toHaveBeenCalledWith("claim_order_emails", expect.anything());
  });

  it("sends with the row's idempotency key and records the provider id", async () => {
    const send = vi.fn(async () => ({ status: "sent" as const, providerId: "re_1" }));
    const admin = fakeAdmin([row()]);
    const tally = await processOrderEmails(admin as never, { transport: { name: "t", send }, origin: "https://d.example" });
    expect(tally.sent).toBe(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "a@example.test", idempotencyKey: "order-email/row-1" }));
    expect(admin.completed[0]).toMatchObject({ p_outcome: "sent", p_provider_message_id: "re_1" });
  });

  it("respects a mute for dispatch emails but never for a receipt, a refund or a payout notice", async () => {
    const send = vi.fn(async () => ({ status: "sent" as const, providerId: null }));
    const muted = { order_updates: false, offers_sales: false };
    const admin = fakeAdmin([row({ id: "r1", kind: "order_shipped", notification_prefs: muted }), row({ id: "r2", kind: "order_paid", notification_prefs: muted }), row({ id: "r3", kind: "order_refunded", notification_prefs: muted }), row({ id: "r4", kind: "payout_setup_reminder", notification_prefs: muted })]);
    await processOrderEmails(admin as never, { transport: { name: "t", send }, origin: "https://d.example" });
    expect(admin.completed.find((c) => c.p_id === "r1")).toMatchObject({ p_outcome: "skipped", p_reason: "muted" });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("claims one row at a time, at most a batch a pass, and leaves the rest unclaimed when time runs out (OS-W41)", async () => {
    const send = vi.fn(async () => ({ status: "sent" as const, providerId: null }));
    const many = fakeAdmin(Array.from({ length: 5 }, (_, i) => row({ id: `r${i}` })));
    const tally = await processOrderEmails(many as never, { transport: { name: "t", send }, origin: "https://d.example", batch: 3 });
    expect(tally.claimed).toBe(3);
    expect(many.queue).toHaveLength(2);
    for (const call of many.rpc.mock.calls.filter(([name]) => name === "claim_order_emails")) expect(call[1]).toEqual({ p_limit: 1 });

    vi.useFakeTimers();
    const slow = { name: "t", send: vi.fn(() => new Promise<never>(() => {})) };
    const late = fakeAdmin(Array.from({ length: 4 }, (_, i) => row({ id: `s${i}` })));
    const pending = processOrderEmails(late as never, { transport: slow, origin: "https://d.example", deadline: Date.now() + 5_000 });
    await vi.advanceTimersByTimeAsync(ORDER_EMAIL_SEND_TIMEOUT_MS + 1);
    expect((await pending).claimed).toBe(1);
    expect(late.queue).toHaveLength(3);
  });

  it("prices in the order's currency and counts every sale a payout reminder covers (OS-W41)", async () => {
    const send = vi.fn(async (_message: { subject: string; text: string }) => ({ status: "sent" as const, providerId: null }));
    const admin = fakeAdmin([row({ id: "p1", kind: "order_paid" }), row({ id: "p2", kind: "payout_setup_reminder" })]);
    await processOrderEmails(admin as never, { transport: { name: "t", send }, origin: "https://d.example" });
    expect(send.mock.calls[0][0].text).toContain("€10");
    expect(send.mock.calls[1][0].subject).toBe("Set up payouts to be paid for your 3 sales");
    expect(send.mock.calls[1][0].text).toContain("and 2 other sales");
  });

  it("a transport that hangs is given up after its timeout and retried later; one that throws is retried", async () => {
    vi.useFakeTimers();
    const hang = { name: "t", send: vi.fn(() => new Promise<never>(() => {})) };
    const admin = fakeAdmin([row()]);
    const pending = processOrderEmails(admin as never, { transport: hang, origin: "https://d.example", deadline: Date.now() + 60_000 });
    await vi.advanceTimersByTimeAsync(ORDER_EMAIL_SEND_TIMEOUT_MS + 1);
    const tally = await pending;
    expect(tally.retrying).toBe(1);
    expect(admin.completed[0]).toMatchObject({ p_outcome: "retry", p_error: "send timed out or threw" });
    vi.useRealTimers();
    const throws = { name: "t", send: vi.fn(async () => { throw new Error("provider down"); }) };
    const second = fakeAdmin([row()]);
    expect((await processOrderEmails(second as never, { transport: throws, origin: "https://d.example" })).retrying).toBe(1);
  });
});
