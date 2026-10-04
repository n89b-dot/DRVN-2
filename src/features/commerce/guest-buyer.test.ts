import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  getUserById: vi.fn(),
  createUser: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.lookup }) }) }),
    auth: { admin: { getUserById: mocks.getUserById, createUser: mocks.createUser } },
  }),
}));

const { MEMBER_EMAIL_AT_GUEST_CHECKOUT, resolveGuestBuyer } = await import("./guest-buyer");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue({ data: null, error: null });
  mocks.createUser.mockResolvedValue({ data: { user: { id: "new-guest" } }, error: null });
});

describe("resolveGuestBuyer", () => {
  it("creates an unconfirmed, claimable account for an unseen address", async () => {
    await expect(resolveGuestBuyer(" New@Example.test ", "Guest Buyer")).resolves.toEqual({ buyer: { id: "new-guest", created: true } });
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: "new@example.test", email_confirm: false }));
  });

  it("never places a guest order in an account whose owner proved the address", async () => {
    mocks.lookup.mockResolvedValue({ data: { user_id: "member" }, error: null });
    mocks.getUserById.mockResolvedValue({ data: { user: { id: "member", email_confirmed_at: "2026-09-01T00:00:00Z" } }, error: null });
    await expect(resolveGuestBuyer("member@example.test", "Attacker")).resolves.toEqual({ error: MEMBER_EMAIL_AT_GUEST_CHECKOUT });

    // Same for an address proven some other way (confirmed_at is the union).
    mocks.getUserById.mockResolvedValue({ data: { user: { id: "member", confirmed_at: "2026-09-01T00:00:00Z" } }, error: null });
    await expect(resolveGuestBuyer("member@example.test", null)).resolves.toEqual({ error: MEMBER_EMAIL_AT_GUEST_CHECKOUT });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("joins an account nobody has proven yet, without creating a duplicate", async () => {
    mocks.lookup.mockResolvedValue({ data: { user_id: "earlier-guest" }, error: null });
    mocks.getUserById.mockResolvedValue({ data: { user: { id: "earlier-guest", email_confirmed_at: null } }, error: null });
    await expect(resolveGuestBuyer("guest@example.test", null)).resolves.toEqual({ buyer: { id: "earlier-guest", created: false } });
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("fails closed when the account can't be checked", async () => {
    mocks.lookup.mockResolvedValue({ data: { user_id: "someone" }, error: null });
    mocks.getUserById.mockResolvedValue({ data: { user: null }, error: { message: "down" } });
    await expect(resolveGuestBuyer("someone@example.test", null)).resolves.toEqual({ error: "We couldn't start that purchase. Nothing was charged." });
    expect(mocks.reportError).toHaveBeenCalledOnce();
  });
});
