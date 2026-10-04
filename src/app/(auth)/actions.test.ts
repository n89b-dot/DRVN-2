import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowAction: vi.fn(),
  network: vi.fn(),
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://drvn.example" }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/beta-access", () => ({ betaCommerceError: vi.fn(), getBetaAccess: vi.fn(), prepareBetaSignup: vi.fn() }));
vi.mock("@/lib/abuse-identity", () => ({ attributedNetworkIdentity: mocks.network }));
vi.mock("@/lib/rate-limit", () => ({
  allowAction: mocks.allowAction,
  RATE_LIMITS: {
    signIn: { action: "sign-in", limit: 10, windowSeconds: 900 },
    signInNetwork: { action: "sign-in-network", limit: 30, windowSeconds: 900 },
    passwordReset: { action: "password-reset", limit: 5, windowSeconds: 1800 },
    passwordResetNetwork: { action: "password-reset-network", limit: 15, windowSeconds: 1800 },
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithPassword: mocks.signInWithPassword, resetPasswordForEmail: mocks.resetPasswordForEmail },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { username: "kaito" } }) }) }) }),
  }),
}));

const { login, requestPasswordReset } = await import("./actions");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const subjects = () => mocks.allowAction.mock.calls.map(([rule, subject]) => [rule.action, subject]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowAction.mockResolvedValue(true);
  mocks.network.mockReturnValue("network:abc");
  mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
});

describe("sign-in throttling", () => {
  it("counts the normalized email and the visitor's network before asking Supabase", async () => {
    await expect(login({}, form({ email: " Kaito@DRVN.test ", password: "pw" }))).rejects.toThrow("redirect:/home");
    const [[emailAction, emailKey], [networkAction, networkKey]] = subjects();
    expect(emailAction).toBe("sign-in");
    expect(emailKey).toMatch(/^email:[0-9a-f]{64}$/);
    expect(emailKey).not.toContain("kaito");
    expect([networkAction, networkKey]).toEqual(["sign-in-network", "network:abc"]);

    // Case and spacing don't open a second bucket.
    mocks.allowAction.mockClear();
    await expect(login({}, form({ email: "kaito@drvn.test", password: "pw" }))).rejects.toThrow("redirect:");
    expect(subjects()[0][1]).toBe(emailKey);
  });

  it("refuses without calling Supabase once either key is exhausted", async () => {
    mocks.allowAction.mockImplementation(async (rule: { action: string }) => rule.action !== "sign-in");
    await expect(login({}, form({ email: "a@drvn.test", password: "pw" }))).resolves.toEqual({
      error: "Too many sign-in attempts. Wait a few minutes and try again.",
    });
    mocks.allowAction.mockImplementation(async (rule: { action: string }) => rule.action !== "sign-in-network");
    await expect(login({}, form({ email: "a@drvn.test", password: "pw" }))).resolves.toHaveProperty("error");
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("never keys sign-in on the shared unattributed bucket", async () => {
    mocks.network.mockReturnValue(null);
    await expect(login({}, form({ email: "a@drvn.test", password: "pw" }))).rejects.toThrow("redirect:");
    expect(subjects().map(([action]) => action)).toEqual(["sign-in"]);
  });
});

describe("password reset throttling", () => {
  const sent = { ok: "If that address has an account, a reset link is on its way." };

  it("sends while within both limits", async () => {
    await expect(requestPasswordReset({}, form({ email: "a@drvn.test" }))).resolves.toEqual(sent);
    expect(subjects().map(([action]) => action)).toEqual(["password-reset", "password-reset-network"]);
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledOnce();
  });

  it("answers a throttled request exactly like a sent one, and sends nothing", async () => {
    mocks.allowAction.mockResolvedValue(false);
    await expect(requestPasswordReset({}, form({ email: "a@drvn.test" }))).resolves.toEqual(sent);
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
