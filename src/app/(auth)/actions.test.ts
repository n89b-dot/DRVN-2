import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowAction: vi.fn(),
  network: vi.fn(),
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  getClaims: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  profileUpdate: vi.fn(),
  adminInsert: vi.fn(),
  reportError: vi.fn(),
  hasAgeConfirmation: vi.fn(),
  recordAgeConfirmation: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://drvn.example" }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/age-confirmation-record", () => ({
  hasAgeConfirmation: mocks.hasAgeConfirmation,
  recordAgeConfirmation: mocks.recordAgeConfirmation,
}));
vi.mock("@/lib/revalidate", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/site", () => ({ siteUrl: () => "https://drvn.example" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: mocks.adminInsert }) }),
}));
vi.mock("@/lib/abuse-identity", () => ({ attributedNetworkIdentity: mocks.network }));
vi.mock("@/lib/rate-limit", () => ({
  allowAction: mocks.allowAction,
  RATE_LIMITS: {
    signIn: { action: "sign-in", limit: 10, windowSeconds: 900 },
    signInEmailCeiling: { action: "sign-in-email", limit: 50, windowSeconds: 900 },
    signInNetwork: { action: "sign-in-network", limit: 30, windowSeconds: 900 },
    passwordReset: { action: "password-reset", limit: 5, windowSeconds: 1800 },
    passwordResetEmailCeiling: { action: "password-reset-email", limit: 10, windowSeconds: 1800 },
    passwordResetNetwork: { action: "password-reset-network", limit: 15, windowSeconds: 1800 },
    signUp: { action: "sign-up", limit: 3, windowSeconds: 3600 },
    signUpEmailCeiling: { action: "sign-up-email", limit: 5, windowSeconds: 3600 },
    signUpNetwork: { action: "sign-up-network", limit: 20, windowSeconds: 3600 },
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      signUp: mocks.signUp,
      signOut: mocks.signOut,
      getClaims: mocks.getClaims,
      getUser: mocks.getUser,
      updateUser: mocks.updateUser,
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { username: "kaito" } }) }) }),
      update: (values: unknown) => ({ eq: () => ({ select: async () => mocks.profileUpdate(values) }) }),
    }),
  }),
}));

const { completeOnboarding, login, requestPasswordReset, signup, updatePassword } = await import("./actions");

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
  mocks.signUp.mockResolvedValue({ data: { user: { id: "new", identities: [{ id: "i1" }] }, session: null }, error: null });
  mocks.hasAgeConfirmation.mockResolvedValue(true);
  mocks.recordAgeConfirmation.mockResolvedValue(true);
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "u1", user_metadata: { avatar_url: "https://img.example/a.png" } } } });
  mocks.profileUpdate.mockReturnValue({ data: [{ id: "u1" }], error: null });
  mocks.adminInsert.mockResolvedValue({ error: null });
});

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("sign-in throttling", () => {
  it("counts the normalized email and the visitor's network before asking Supabase", async () => {
    await expect(login({}, form({ email: " Kaito@DRVN.test ", password: "pw" }))).rejects.toThrow("redirect:/home");
    const [[emailAction, emailKey], [ceilingAction, ceilingKey], [networkAction, networkKey]] = subjects();
    expect(emailAction).toBe("sign-in");
    expect(emailKey).toMatch(/^email:[0-9a-f]{64}:network:abc$/);
    expect(emailKey).not.toContain("kaito");
    expect(ceilingAction).toBe("sign-in-email");
    expect(ceilingKey).toMatch(/^email:[0-9a-f]{64}$/);
    expect([networkAction, networkKey]).toEqual(["sign-in-network", "network:abc"]);

    // Case and spacing don't open a second bucket.
    mocks.allowAction.mockClear();
    await expect(login({}, form({ email: "kaito@drvn.test", password: "pw" }))).rejects.toThrow("redirect:");
    expect(subjects()[0][1]).toBe(emailKey);
  });

  it("does not let attempts from elsewhere use up the owner's own tries", async () => {
    // The tight limit is spent for the attacker's network only.
    mocks.allowAction.mockImplementation(
      async (rule: { action: string }, subject: string) => !(rule.action === "sign-in" && subject.endsWith(":network:attacker"))
    );
    mocks.network.mockReturnValue("network:attacker");
    await expect(login({}, form({ email: "a@drvn.test", password: "junk" }))).resolves.toHaveProperty("error");
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();

    mocks.network.mockReturnValue("network:owner");
    await expect(login({}, form({ email: "a@drvn.test", password: "pw" }))).rejects.toThrow("redirect:");
    expect(mocks.signInWithPassword).toHaveBeenCalledOnce();
  });

  it("still stops one account being tried from many places", async () => {
    mocks.allowAction.mockImplementation(async (rule: { action: string }) => rule.action !== "sign-in-email");
    await expect(login({}, form({ email: "a@drvn.test", password: "pw" }))).resolves.toHaveProperty("error");
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
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
    expect(subjects()[0][1]).toMatch(/^email:[0-9a-f]{64}$/);
  });
});

describe("password reset throttling", () => {
  const sent = { ok: "If that address has an account, a reset link is on its way." };

  it("sends while within both limits", async () => {
    await expect(requestPasswordReset({}, form({ email: "a@drvn.test" }))).resolves.toEqual(sent);
    expect(subjects().map(([action]) => action)).toEqual([
      "password-reset",
      "password-reset-email",
      "password-reset-network",
    ]);
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledOnce();
  });

  it("still sends the owner's reset after someone elsewhere has used up theirs", async () => {
    mocks.allowAction.mockImplementation(
      async (rule: { action: string }, subject: string) =>
        !(rule.action === "password-reset" && subject.endsWith(":network:attacker"))
    );
    mocks.network.mockReturnValue("network:attacker");
    await requestPasswordReset({}, form({ email: "a@drvn.test" }));
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
    mocks.network.mockReturnValue("network:owner");
    await expect(requestPasswordReset({}, form({ email: "a@drvn.test" }))).resolves.toEqual(sent);
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledOnce();
  });

  it("answers a throttled request exactly like a sent one, and sends nothing", async () => {
    mocks.allowAction.mockResolvedValue(false);
    await expect(requestPasswordReset({}, form({ email: "a@drvn.test" }))).resolves.toEqual(sent);
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

// Readiness N42: sign-up is throttled before anything can email a stranger.
describe("sign-up throttling", () => {
  const attempt = () => signup({}, form({ email: " New@DRVN.test ", password: "long-enough-pass", age_confirmed: "yes" }));

  it("counts the hashed email and the network before Supabase", async () => {
    await expect(attempt()).rejects.toThrow("redirect:/login?message=check-email");
    expect(subjects().map(([action]) => action)).toEqual(["sign-up", "sign-up-email", "sign-up-network"]);
    expect(subjects()[0][1]).toMatch(/^email:[0-9a-f]{64}:network:abc$/);
    expect(JSON.stringify(subjects())).not.toContain("new@drvn");
    expect(mocks.allowAction.mock.invocationCallOrder[0]).toBeLessThan(mocks.signUp.mock.invocationCallOrder[0]);
    expect(mocks.signUp).toHaveBeenCalledOnce();
  });

  it("sends no confirmation email once any key is exhausted", async () => {
    for (const exhausted of ["sign-up", "sign-up-email", "sign-up-network"]) {
      mocks.signUp.mockClear();
      mocks.allowAction.mockImplementation(async (rule: { action: string }) => rule.action !== exhausted);
      await expect(attempt()).resolves.toMatchObject({ error: "Too many sign-up attempts. Wait a while and try again." });
      expect(mocks.signUp).not.toHaveBeenCalled();
    }
  });

  it("keeps the typed email and says nothing about whether it is registered", async () => {
    mocks.allowAction.mockResolvedValue(false);
    await expect(attempt()).resolves.toEqual({
      error: "Too many sign-up attempts. Wait a while and try again.",
      field: undefined,
      email: "New@DRVN.test",
    });
  });

  it("shows public copy, not Supabase's wording, when sign-up fails", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error: { code: "unexpected_failure", message: "Database error saving new user" } });
    const result = await attempt();
    expect(result.error).toBe("That didn't go through. Try again in a moment.");
    expect(mocks.reportError).toHaveBeenCalledWith("[auth] sign-up failed", expect.anything());
  });
});

// Readiness N43: a banned account is told plainly, never to retry.
describe("sign-in errors", () => {
  it("gives a banned account the durable access message", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: "user_banned", message: "User is banned" } });
    const result = await login({}, form({ email: "gone@drvn.test", password: "pw" }));
    expect(result.error).toMatch(/can't sign in/);
    expect(result.error).not.toMatch(/try again|banned/i);
  });
});

// Readiness N20: the reset form needs a session opened from an emailed link.
describe("password reset completion", () => {
  const reset = () => updatePassword({}, form({ password: "brand-new-pass", confirm: "brand-new-pass" }));

  it("sets the password for a session opened from a reset link just now", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u1", amr: [{ method: "otp", timestamp: nowSeconds() - 60 }] } }, error: null });
    await expect(reset()).rejects.toThrow("redirect:/home");
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "brand-new-pass" });
  });

  it("refuses an ordinary signed-in session and changes nothing", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u1", amr: [{ method: "password", timestamp: nowSeconds() - 5 }] } }, error: null });
    await expect(reset()).resolves.toEqual({ error: expect.stringMatching(/fresh reset link/) });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("refuses a reset session that is over an hour old, and a missing session", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u1", amr: [{ method: "otp", timestamp: nowSeconds() - 2 * 3600 }] } }, error: null });
    await expect(reset()).resolves.toHaveProperty("error");
    mocks.getClaims.mockResolvedValue({ data: null, error: { message: "Auth session missing!" } });
    await expect(reset()).resolves.toEqual({ error: "This reset link has expired. Request a new one." });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("never shows Supabase's wording when the update fails", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u1", amr: [{ method: "otp", timestamp: nowSeconds() - 60 }] } }, error: null });
    mocks.updateUser.mockResolvedValue({ error: { code: "unexpected_failure", message: "AuthApiError: internal" } });
    await expect(reset()).resolves.toEqual({ error: "That didn't go through. Try again in a moment." });
    mocks.updateUser.mockResolvedValue({ error: { code: "same_password", message: "New password should be different from the old password." } });
    await expect(reset()).resolves.toEqual({ error: "That's the password you already have." });
  });
});

// Readiness N40: an account with no profile row can finish onboarding, or
// leave, instead of looping.
describe("onboarding an account with no profile", () => {
  const finish = () => completeOnboarding({}, form({ username: "Kaito_R", display_name: "Kaito", next: "/garage" }));

  it("updates the existing profile as before", async () => {
    await expect(finish()).rejects.toThrow("redirect:/garage");
    expect(mocks.profileUpdate).toHaveBeenCalledWith({ username: "kaito_r", display_name: "Kaito" });
    expect(mocks.adminInsert).not.toHaveBeenCalled();
  });

  it("creates the missing profile row instead of pretending an empty update worked", async () => {
    mocks.profileUpdate.mockReturnValue({ data: [], error: null });
    await expect(finish()).rejects.toThrow("redirect:/garage");
    expect(mocks.adminInsert).toHaveBeenCalledWith({
      id: "u1",
      username: "kaito_r",
      display_name: "Kaito",
      avatar_url: "https://img.example/a.png",
    });
  });

  it("reports a taken handle when the created row collides", async () => {
    mocks.profileUpdate.mockReturnValue({ data: [], error: null });
    mocks.adminInsert.mockResolvedValue({ error: { code: "23505", message: 'duplicate key value violates unique constraint "profiles_username_key"' } });
    await expect(finish()).resolves.toEqual({ error: "That username is taken." });
  });

  // OS-W31 (#86 follow-up): the invite-only beta is gone, so no access check
  // can refuse onboarding; the missing-profile repair above still runs.
  it("never asks the removed beta whether this account may finish", async () => {
    const source = (await import("node:fs")).readFileSync("src/app/(auth)/actions.ts", "utf8");
    expect(source).not.toMatch(/beta-access|getBetaAccess|prepareBetaSignup|beta_claim_id/);
  });
});

// R69-age: the server actions are the check, not the form.
describe("18+ confirmation", () => {
  it("sign-up refuses a post without the box, before counting, mailing or creating anything", async () => {
    const result = await signup({}, form({ email: "new@drvn.test", password: "long-enough-pass" }));
    expect(result).toEqual({ error: "Confirm you're 18 or over to continue.", field: "age", email: "new@drvn.test" });
    for (const value of ["", "on", "no", "true"]) {
      await expect(signup({}, form({ email: "new@drvn.test", password: "long-enough-pass", age_confirmed: value }))).resolves.toHaveProperty("field", "age");
    }
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.allowAction).not.toHaveBeenCalled();
    expect(mocks.recordAgeConfirmation).not.toHaveBeenCalled();
  });

  it("sign-up records the confirmation against the new account", async () => {
    await expect(signup({}, form({ email: "new@drvn.test", password: "long-enough-pass", age_confirmed: "yes" }))).rejects.toThrow("redirect:/login?message=check-email");
    expect(mocks.recordAgeConfirmation).toHaveBeenCalledWith("new", "email_signup");
  });

  it("records nothing when the address already had an account", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: { id: "obfuscated", identities: [] }, session: null }, error: null });
    await expect(signup({}, form({ email: "taken@drvn.test", password: "long-enough-pass", age_confirmed: "yes" }))).rejects.toThrow("redirect:");
    expect(mocks.recordAgeConfirmation).not.toHaveBeenCalled();
  });

  it("onboarding without a record refuses a post without the box and sets no handle", async () => {
    mocks.hasAgeConfirmation.mockResolvedValue(false);
    const result = await completeOnboarding({}, form({ username: "kaito_r", display_name: "Kaito" }));
    expect(result).toEqual({ error: "Confirm you're 18 or over to continue.", field: "age" });
    expect(mocks.profileUpdate).not.toHaveBeenCalled();
    expect(mocks.adminInsert).not.toHaveBeenCalled();
    expect(mocks.recordAgeConfirmation).not.toHaveBeenCalled();
  });

  it("onboarding records the box (a first Google sign-in) before the handle is set", async () => {
    mocks.hasAgeConfirmation.mockResolvedValue(false);
    await expect(completeOnboarding({}, form({ username: "kaito_r", display_name: "Kaito", age_confirmed: "yes" }))).rejects.toThrow("redirect:/garage");
    expect(mocks.recordAgeConfirmation).toHaveBeenCalledWith("u1", "onboarding");
    expect(mocks.recordAgeConfirmation.mock.invocationCallOrder[0]).toBeLessThan(mocks.profileUpdate.mock.invocationCallOrder[0]);
  });

  it("onboarding stops when the confirmation can't be saved", async () => {
    mocks.hasAgeConfirmation.mockResolvedValue(false);
    mocks.recordAgeConfirmation.mockResolvedValue(false);
    await expect(completeOnboarding({}, form({ username: "kaito_r", display_name: "Kaito", age_confirmed: "yes" }))).resolves.toEqual({ error: "We couldn't save that. Try again." });
    expect(mocks.profileUpdate).not.toHaveBeenCalled();
  });

  it("onboarding doesn't ask again after sign-up or checkout recorded it", async () => {
    await expect(completeOnboarding({}, form({ username: "kaito_r", display_name: "Kaito" }))).rejects.toThrow("redirect:/garage");
    expect(mocks.recordAgeConfirmation).not.toHaveBeenCalled();
  });
});

// F-3 (PRD 2026-09-24): sign-up and return-to-where-you-were are unchanged;
// "Add your car" carries next=/garage through sign-up; an account with
// nowhere to return to finishes onboarding on the garage, which opens on the
// add-car form when it is empty; "Skip — just browsing" goes to Home.
describe("sign-up and return (F-3)", () => {
  const signUpAs = (next?: string) =>
    signup({}, form({ email: "new@drvn.test", password: "long-enough-pw", age_confirmed: "yes", ...(next ? { next } : {}) }));

  it("carries Add your car's next=/garage into the confirmation link and the email notice", async () => {
    await expect(signUpAs("/garage")).rejects.toThrow("redirect:/login?message=check-email&next=%2Fgarage");
    const redirectTo = new URL(mocks.signUp.mock.calls[0][0].options.emailRedirectTo);
    expect(redirectTo.pathname).toBe("/callback");
    expect(redirectTo.searchParams.get("next")).toBe("/garage");
  });

  it("carries next=/garage straight into onboarding when sign-up opens a session", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: { id: "new" }, session: { access_token: "t" } }, error: null });
    await expect(signUpAs("/garage")).rejects.toThrow("redirect:/onboarding?next=%2Fgarage");
  });

  it("keeps any other return target, and drops an off-site one", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: { id: "new" }, session: { access_token: "t" } }, error: null });
    await expect(signUpAs("/listings/abc")).rejects.toThrow("redirect:/onboarding?next=%2Flistings%2Fabc");
    await expect(signUpAs("https://evil.example/x")).rejects.toThrow(/^redirect:\/onboarding$/);
  });

  const onboard = (next?: string) =>
    completeOnboarding({}, form({ username: "kaito_r", display_name: "Kaito", ...(next !== undefined ? { next } : {}) }));

  it("finishes on the garage (add-car) when there is nowhere to return to", async () => {
    await expect(onboard()).rejects.toThrow(/^redirect:\/garage$/);
    await expect(onboard("")).rejects.toThrow(/^redirect:\/garage$/);
  });

  it("sends “Skip — just browsing” (next=/home) to Home", async () => {
    await expect(onboard("/home")).rejects.toThrow(/^redirect:\/home$/);
  });

  it("returns to where the visitor was when there is a target", async () => {
    await expect(onboard("/listings/abc")).rejects.toThrow(/^redirect:\/listings\/abc$/);
    await expect(onboard("//evil.example")).rejects.toThrow(/^redirect:\/garage$/);
  });
});
