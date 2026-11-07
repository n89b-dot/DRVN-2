import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowAction: vi.fn(),
  reportError: vi.fn(),
  signInWithPassword: vi.fn(),
  getClaims: vi.fn(),
}));

vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/rate-limit", () => ({
  allowAction: mocks.allowAction,
  RATE_LIMITS: { reauthenticate: { action: "reauthenticate", limit: 10, windowSeconds: 900 } },
}));

import { confirmIdentity } from "./confirm-identity";

const supabase = { auth: { signInWithPassword: mocks.signInWithPassword, getClaims: mocks.getClaims } } as never;
const passwordMember = { id: "u1", email: "member@drvn.test", app_metadata: { provider: "email", providers: ["email"] } };
const googleMember = { id: "u2", email: "google@drvn.test", app_metadata: { provider: "google", providers: ["google"] } };
const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowAction.mockResolvedValue(true);
  mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  // An hour-old session: signed in, but not "just now".
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u1", amr: [{ method: "password", timestamp: now() - 3600 }] } }, error: null });
});

// Readiness N41: a session alone can't delete the account or move its email.
describe("confirmIdentity", () => {
  it("accepts the member's password, checked by Supabase", async () => {
    await expect(confirmIdentity(supabase, passwordMember, "right-pass")).resolves.toEqual({ ok: true });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "member@drvn.test", password: "right-pass" });
    expect(mocks.allowAction).toHaveBeenCalledWith(expect.objectContaining({ action: "reauthenticate" }), "user:u1");
  });

  it("refuses a wrong password and an old session with no password", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: "invalid_credentials", message: "Invalid login credentials" } });
    await expect(confirmIdentity(supabase, passwordMember, "wrong")).resolves.toEqual({ ok: false, reauth: "password", error: "That password isn't right." });
    await expect(confirmIdentity(supabase, passwordMember, "")).resolves.toEqual({
      ok: false,
      reauth: "password",
      error: "Enter your password to confirm it's you.",
    });
  });

  it("stops guessing once the member's attempts are used up", async () => {
    mocks.allowAction.mockResolvedValue(false);
    const result = await confirmIdentity(supabase, passwordMember, "guess");
    expect(result).toMatchObject({ ok: false });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("never shows the provider's wording for an unexpected failure", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: "unexpected_failure", message: "connection refused to 10.0.0.4" } });
    const result = await confirmIdentity(supabase, passwordMember, "pass");
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain("10.0.0.4");
    expect(mocks.reportError).toHaveBeenCalled();
  });

  it("lets a Google-only member through only straight after signing in with Google again", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u2", amr: [{ method: "oauth", timestamp: now() - 3600 }] } }, error: null });
    await expect(confirmIdentity(supabase, googleMember, "")).resolves.toEqual({
      ok: false,
      reauth: "oauth",
      error: "Confirm it's you with Google first, then try again.",
    });

    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u2", amr: [{ method: "oauth", timestamp: now() - 30 }] } }, error: null });
    await expect(confirmIdentity(supabase, googleMember, "")).resolves.toEqual({ ok: true });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("never accepts a fresh session that belongs to someone else, or unverifiable claims", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "someone-else", amr: [{ method: "oauth", timestamp: now() }] } }, error: null });
    await expect(confirmIdentity(supabase, googleMember, "")).resolves.toMatchObject({ ok: false });
    mocks.getClaims.mockResolvedValue({ data: null, error: { message: "invalid JWT" } });
    await expect(confirmIdentity(supabase, googleMember, "")).resolves.toMatchObject({ ok: false });
    mocks.getClaims.mockRejectedValue(new Error("network"));
    await expect(confirmIdentity(supabase, googleMember, "")).resolves.toMatchObject({ ok: false });
  });
});
