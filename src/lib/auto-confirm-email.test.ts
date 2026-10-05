import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ deliver: vi.fn(), reportError: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/commerce/guest-buyer", () => ({ deliverOrderAccessLink: mocks.deliver }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { AUTO_CONFIRM_DATE_KEY, autoConfirmDateLabel, processAutoConfirmEmails } from "./auto-confirm-email";

type Row = { order_id: string; confirm_at: string; email_attempts: number; orders: { buyer_id: string | null; status: string } | null };
type Account = { email: string | null; email_confirmed_at: string | null };

const CONFIRM_AT = "2026-10-12T09:30:00.000Z";
const row = (overrides: Partial<Row> = {}): Row => ({
  order_id: "order-1", confirm_at: CONFIRM_AT, email_attempts: 0, orders: { buyer_id: "buyer-1", status: "shipped" }, ...overrides,
});

function adminFor(rows: Row[], accounts: Record<string, Account | null>) {
  const updates: Array<{ orderId: string; fields: Record<string, unknown> }> = [];
  const metadata: Array<{ userId: string; value: unknown }> = [];
  const events: string[] = [];
  const query: Record<string, unknown> = {};
  for (const method of ["select", "is", "lt", "gt", "order"]) query[method] = () => query;
  query.limit = async () => ({ data: rows, error: null });
  const admin = {
    from: () => ({
      ...query,
      update: (fields: Record<string, unknown>) => ({
        eq: async (_column: string, orderId: string) => { updates.push({ orderId, fields }); return { error: null }; },
      }),
    }),
    auth: {
      admin: {
        getUserById: async (id: string) => accounts[id] ? { data: { user: { id, ...accounts[id] } }, error: null } : { data: { user: null }, error: { message: "missing" } },
        updateUserById: async (userId: string, body: { user_metadata: Record<string, unknown> }) => {
          const value = body.user_metadata[AUTO_CONFIRM_DATE_KEY];
          metadata.push({ userId, value });
          events.push(value === null ? "clear" : "set");
          return { error: null };
        },
      },
    },
  };
  mocks.deliver.mockImplementation(async () => { events.push("send"); });
  return { admin: admin as unknown as Parameters<typeof processAutoConfirmEmails>[0], updates, metadata, events };
}

beforeEach(() => vi.clearAllMocks());

describe("processAutoConfirmEmails", () => {
  it("gives the date in words the template can print", () => {
    expect(autoConfirmDateLabel(CONFIRM_AT)).toBe("12 October 2026");
    // The date is the UTC day the database will act on, not the server's local day.
    expect(autoConfirmDateLabel("2026-10-12T23:59:59.000Z")).toBe("12 October 2026");
  });

  it("emails a guest their order link with the date, then clears the date", async () => {
    const { admin, updates, metadata, events } = adminFor([row()], { "buyer-1": { email: "guest@example.test", email_confirmed_at: null } });
    const result = await processAutoConfirmEmails(admin);

    expect(result).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(events).toEqual(["set", "send", "clear"]);
    expect(metadata[0]).toEqual({ userId: "buyer-1", value: "12 October 2026" });
    expect(mocks.deliver).toHaveBeenCalledWith("guest@example.test", "/orders/order-1");
    expect(updates).toHaveLength(1);
    expect(updates[0].fields).toMatchObject({ email_last_error: null });
    expect(typeof updates[0].fields.emailed_at).toBe("string");
  });

  it("does not email a member who has proven their address", async () => {
    const { admin, updates } = adminFor([row()], { "buyer-1": { email: "member@example.test", email_confirmed_at: "2026-09-01T00:00:00Z" } });
    expect(await processAutoConfirmEmails(admin)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(mocks.deliver).not.toHaveBeenCalled();
    // Recorded as done, so it is not looked at again every pass.
    expect(typeof updates[0].fields.emailed_at).toBe("string");
  });

  it("sends nothing for an order that is no longer waiting on the buyer", async () => {
    const { admin } = adminFor([row({ orders: { buyer_id: "buyer-1", status: "disputed" } })], { "buyer-1": { email: "guest@example.test", email_confirmed_at: null } });
    expect(await processAutoConfirmEmails(admin)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("clears the date and counts an attempt when the email can't be sent", async () => {
    const { admin, updates, events } = adminFor([row({ email_attempts: 2 })], { "buyer-1": { email: "guest@example.test", email_confirmed_at: null } });
    mocks.deliver.mockImplementation(async () => { events.push("send"); throw new Error("Order access email delivery failed: over_email_send_rate_limit"); });
    const result = await processAutoConfirmEmails(admin);

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(events).toEqual(["set", "send", "clear"]);
    expect(updates[0].fields).toMatchObject({ email_attempts: 3 });
    expect(updates[0].fields.emailed_at).toBeUndefined();
    expect(String(updates[0].fields.email_last_error)).toContain("over_email_send_rate_limit");
  });
});
