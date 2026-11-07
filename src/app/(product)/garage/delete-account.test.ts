import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  confirmIdentity: vi.fn(),
  reportError: vi.fn(),
  rpc: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/confirm-identity", () => ({ confirmIdentity: mocks.confirmIdentity }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "owner", email: "owner@drvn.test", app_metadata: { providers: ["email"] } } } }),
      signOut: mocks.signOut,
    },
    rpc: mocks.rpc,
  }),
}));

const { deleteAccount } = await import("./actions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirmIdentity.mockResolvedValue({ ok: true });
  mocks.rpc.mockResolvedValue({ data: { outcome: "cleanup_pending", job_id: "job-1" }, error: null });
});

// Readiness N41: typing DELETE at an unlocked session is not enough.
describe("account deletion", () => {
  it("asks for the password typed now before requesting deletion", async () => {
    await expect(deleteAccount({}, form({ confirm: "DELETE", current_password: "typed-now" }))).rejects.toThrow(
      "redirect:/login?deletion=requested&reference=job-1"
    );
    expect(mocks.confirmIdentity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "owner" }), "typed-now");
    expect(mocks.confirmIdentity.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]);
  });

  it("requests nothing when the member can't confirm it's them", async () => {
    mocks.confirmIdentity.mockResolvedValue({ ok: false, reauth: "password", error: "Enter your password to confirm it's you." });
    await expect(deleteAccount({}, form({ confirm: "DELETE" }))).resolves.toEqual({
      error: "Enter your password to confirm it's you.",
      reauth: "password",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("offers Google again to a Google-only member", async () => {
    mocks.confirmIdentity.mockResolvedValue({ ok: false, reauth: "oauth", error: "Confirm it's you with Google first, then try again." });
    await expect(deleteAccount({}, form({ confirm: "DELETE" }))).resolves.toMatchObject({ reauth: "oauth" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("still needs DELETE typed first", async () => {
    await expect(deleteAccount({}, form({ confirm: "delete", current_password: "typed-now" }))).resolves.toEqual({ error: "Type DELETE to confirm." });
    expect(mocks.confirmIdentity).not.toHaveBeenCalled();
  });

  // N49: the database's wording stays in telemetry.
  it("never shows the database's error text", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "could not serialize access due to concurrent update" } });
    const result = await deleteAccount({}, form({ confirm: "DELETE", current_password: "typed-now" }));
    expect(result.error).toBe("Couldn't request deletion. Nothing was changed — try again.");
    expect(mocks.reportError).toHaveBeenCalledWith("[settings] account deletion request failed", expect.objectContaining({ userId: "owner" }));

    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Account access is suspended" } });
    const suspended = await deleteAccount({}, form({ confirm: "DELETE", current_password: "typed-now" }));
    expect(suspended.error).toMatch(/suspended/);
    expect(suspended.error).not.toContain("Account access is suspended");
  });
});
