import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
const alerts = vi.hoisted(() => ({ sendAdminAlert: vi.fn(async () => {}) }));
vi.mock("@/lib/admin/alerts", () => alerts);

const { ORDER_EMAIL_SEND_TIMEOUT_MS, processOrderEmails } = await import("./order-emails");

const ORDER = "a1b2c3d4-0000-4000-8000-000000000001";
type Row = { id: string; attempt: number; recipient_id: string; order_id: string; kind: string; email: string; guest: boolean; buyer: boolean; notification_prefs: unknown };
const row = (over: Partial<Row> = {}): Row => ({ id: "row-1", attempt: 1, recipient_id: "u1", order_id: ORDER, kind: "order_shipped", email: "a@example.test", guest: false, buyer: true, notification_prefs: {}, ...over });
/** What complete_order_email answers (20261111090000): the row's new status, or 'held'. `fifth`: the retry was the fifth attempt. */
const answers = (outcome: unknown, fifth: boolean) => (outcome === "retry" ? (fifth ? "failed" : "pending") : outcome === "rejected" ? "skipped" : outcome === "provider" ? "held" : outcome);

function fakeAdmin(rows: Row[], order: Record<string, unknown> = {}) {
  const completed: Record<string, unknown>[] = [];
  const queue = [...rows];
  const admin = {
    completed,
    queue,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_order_emails") return { data: queue.splice(0, Number(args.p_limit)), error: null };
      if (name === "complete_order_email") { completed.push(args); return { data: answers(args.p_outcome, Number(args.p_attempt) >= 5), error: null }; }
      if (name === "skip_order_emails_email_off") return { data: 3, error: null };
      throw new Error(`unexpected ${name}`);
    }),
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) builder[m] = () => builder;
      builder.maybeSingle = async () =>
        table === "payout_setup_reminders"
          ? { data: { sale_count: 3 }, error: null }
          : { data: { id: ORDER, total_cents: 1000, refunded_cents: 0, currency: "EUR", dispatch_by: null, carrier: "UPS", tracking_number: "1Z", cancel_reason: null, dispute_reason: null, ...order }, error: null };
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: table === "order_items" ? [{ title: "Turbo" }] : [], error: null });
      return builder;
    },
  };
  return admin;
}

afterEach(() => { vi.useRealTimers(); alerts.sendAdminAlert.mockClear(); });

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
    const send = vi.fn<(message: { subject: string; text: string }) => Promise<{ status: "sent"; providerId: null }>>(async () => ({ status: "sent", providerId: null }));
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

  it("N1063: a fault with our own provider account stops the pass, keeps the row uncounted, and alerts once an hour (work review #147)", async () => {
    const send = vi.fn(async () => ({ status: "retry" as const, reason: "resend: 401 missing_api_key", provider: true as const }));
    const admin = fakeAdmin([row({ id: "h1" }), row({ id: "h2" }), row({ id: "h3" })]);
    const tally = await processOrderEmails(admin as never, { transport: { name: "resend", send }, origin: "https://d.example" });
    // One row tried, and put back as held; the others never claimed, so no attempt of theirs is spent.
    expect(send).toHaveBeenCalledTimes(1);
    expect(admin.completed).toEqual([expect.objectContaining({ p_id: "h1", p_outcome: "provider", p_error: "resend: 401 missing_api_key" })]);
    expect(admin.queue).toHaveLength(2);
    expect(tally).toMatchObject({ claimed: 1, sent: 0, held: 1, retrying: 1, failed: 0 });
    expect(alerts.sendAdminAlert).toHaveBeenCalledTimes(1);
    expect(alerts.sendAdminAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "order_email_provider", dedupKey: expect.stringMatching(/^order-email-provider:\d{4}-\d{2}-\d{2}T\d{2}$/) }));
    // The alert names the provider's status and code, never an address.
    expect(JSON.stringify(alerts.sendAdminAlert.mock.calls)).not.toContain("a@example.test");
  });

  it("N1063: an email that will never be sent is said once, with its order: a fifth failed attempt, and a message the provider refuses", async () => {
    const down = vi.fn(async () => ({ status: "retry" as const, reason: "resend: 503" }));
    const failing = fakeAdmin([row({ id: "f1", attempt: 5 })]);
    expect(await processOrderEmails(failing as never, { transport: { name: "t", send: down }, origin: "https://d.example" })).toMatchObject({ failed: 1, retrying: 0 });
    expect(alerts.sendAdminAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "order_email_failed", orderId: ORDER, dedupKey: "order-email-failed:f1", title: expect.stringContaining("five attempts") }));

    alerts.sendAdminAlert.mockClear();
    const refuses = vi.fn(async () => ({ status: "rejected" as const, reason: "resend: 422 validation_error" }));
    const refused = fakeAdmin([row({ id: "f2" })]);
    expect(await processOrderEmails(refused as never, { transport: { name: "t", send: refuses }, origin: "https://d.example" })).toMatchObject({ skipped: 1, failed: 0 });
    expect(alerts.sendAdminAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "order_email_failed", orderId: ORDER, dedupKey: "order-email-failed:f2", title: expect.stringContaining("refused") }));

    // An ordinary retry, or a mute, raises nothing.
    alerts.sendAdminAlert.mockClear();
    const retrying = fakeAdmin([row({ id: "f3", attempt: 2 }), row({ id: "f4", notification_prefs: { order_updates: false } })]);
    await processOrderEmails(retrying as never, { transport: { name: "t", send: down }, origin: "https://d.example" });
    expect(alerts.sendAdminAlert).not.toHaveBeenCalled();
  });

  it("N1063: the time sets the batch: a pass sends everything waiting, not ten", async () => {
    const send = vi.fn(async () => ({ status: "sent" as const, providerId: null }));
    const admin = fakeAdmin(Array.from({ length: 64 }, (_, i) => row({ id: `b${i}` })));
    const tally = await processOrderEmails(admin as never, { transport: { name: "t", send }, origin: "https://d.example" });
    expect(tally).toMatchObject({ claimed: 64, sent: 64 });
    expect(admin.queue).toHaveLength(0);
    // And a pass with no time left sends nothing and claims nothing.
    const late = fakeAdmin([row()]);
    expect((await processOrderEmails(late as never, { transport: { name: "t", send }, origin: "https://d.example", deadline: Date.now() - 1 })).claimed).toBe(0);
    expect(late.queue).toHaveLength(1);
  });

  it("N1063: the facts behind the words come from the order: who the email is to, a lost card dispute, DRVN's own cancel reason", async () => {
    const send = vi.fn<(message: { subject: string; text: string }) => Promise<{ status: "sent"; providerId: null }>>(async () => ({ status: "sent", providerId: null }));
    const lost = fakeAdmin([row({ id: "c1", kind: "order_refunded", buyer: true }), row({ id: "c2", kind: "order_refunded", buyer: false })], { cancel_reason: "Card dispute lost (dp_123)" });
    await processOrderEmails(lost as never, { transport: { name: "t", send }, origin: "https://d.example" });
    expect(send.mock.calls[0][0].text).toContain("DRVN is not sending a separate refund");
    expect(send.mock.calls[1][0].text).toContain("took the payment back");
    for (const [message] of send.mock.calls) expect(message.text).not.toContain("refund was issued");

    send.mockClear();
    const cancelled = fakeAdmin([row({ id: "c3", kind: "order_cancelled" }), row({ id: "c4", kind: "order_partially_refunded" })], { cancel_reason: "checkout not completed in time", refunded_cents: 250 });
    await processOrderEmails(cancelled as never, { transport: { name: "t", send }, origin: "https://d.example" });
    expect(send.mock.calls[0][0].text).toContain("because checkout wasn't completed in time");
    expect(send.mock.calls[1][0].text).toContain("€2.50 of €10 has been refunded so far");

    // A person's reason never reaches the email.
    send.mockClear();
    const personal = fakeAdmin([row({ id: "c5", kind: "order_cancelled" })], { cancel_reason: "Sold it elsewhere, call me on 07123 456789" });
    await processOrderEmails(personal as never, { transport: { name: "t", send }, origin: "https://d.example" });
    expect(send.mock.calls[0][0].text).not.toMatch(/07123|elsewhere/);
  });
});
