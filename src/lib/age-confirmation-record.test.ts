import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ row: vi.fn(), lookups: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            mocks.lookups();
            return mocks.row();
          },
        }),
      }),
    }),
  }),
}));

const { needsReturningAgeConfirmation } = await import("./age-confirmation-record");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.row.mockReturnValue({ data: null, error: null });
});

describe("needsReturningAgeConfirmation (N686)", () => {
  it("N686: an earlier member with no record must confirm; one on record need not", async () => {
    await expect(needsReturningAgeConfirmation({ id: "u1", created_at: "2026-10-01T00:00:00Z" })).resolves.toBe(true);
    mocks.row.mockReturnValue({ data: { user_id: "u1" }, error: null });
    await expect(needsReturningAgeConfirmation({ id: "u1", created_at: "2026-10-01T00:00:00Z" })).resolves.toBe(false);
  });

  it("N686: an account created since the confirmation shipped is never looked up", async () => {
    await expect(needsReturningAgeConfirmation({ id: "u2", created_at: "2026-11-09T00:00:00Z" })).resolves.toBe(false);
    expect(mocks.lookups).not.toHaveBeenCalled();
  });

  it("N686: a failed lookup asks, since asking again is harmless", async () => {
    mocks.row.mockReturnValue({ data: null, error: { message: "timeout" } });
    await expect(needsReturningAgeConfirmation({ id: "u1", created_at: "2026-10-01T00:00:00Z" })).resolves.toBe(true);
  });
});
