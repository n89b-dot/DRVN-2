import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  revalidatePath: vi.fn(),
  reportError: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  deliverNotification: vi.fn(),
  confirmIdentity: vi.fn(),
  allowAction: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/notifications/deliver", () => ({ deliverNotification: mocks.deliverNotification }));
vi.mock("@/lib/confirm-identity", () => ({ confirmIdentity: mocks.confirmIdentity }));
vi.mock("@/lib/rate-limit", () => ({
  allowAction: mocks.allowAction,
  RATE_LIMITS: { passwordSetupLink: { action: "password-setup-link", limit: 3, windowSeconds: 1800 } },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: mocks.getUser,
      signInWithPassword: mocks.signInWithPassword,
      updateUser: mocks.updateUser,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
    },
  }),
}));

import { changeEmail, changePassword, sendPasswordSetupLink } from "./account-actions";

function emailForm(email: string) {
  const form = new FormData();
  form.set("email", email);
  return form;
}

function passwordForm(current: string, next: string) {
  const form = new FormData();
  form.set("current_password", current);
  form.set("password", next);
  form.set("confirm", next);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "user-1", email: "member@drvn.test" } },
    error: null,
  });
  mocks.signInWithPassword.mockResolvedValue({ error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.deliverNotification.mockResolvedValue("delivered");
  mocks.confirmIdentity.mockResolvedValue({ ok: true });
  mocks.allowAction.mockResolvedValue(true);
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  process.env.NEXT_PUBLIC_SITE_URL = "https://drvn.example";
});

// Readiness 53: the confirmation link lands on Settings, and a changed
// password is something the owner hears about.
describe("email change and password change notices", () => {
  it("asks Supabase to return the email-change link to /confirm with Settings as the destination", async () => {
    await expect(changeEmail({}, emailForm("new@drvn.test"))).resolves.toEqual({
      ok: "Confirm the change from the link we sent to new@drvn.test.",
    });
    expect(mocks.updateUser).toHaveBeenCalledWith(
      { email: "new@drvn.test" },
      { emailRedirectTo: `https://drvn.example/confirm?next=${encodeURIComponent("/settings?changed=email")}` },
    );
  });

  it("notifies the owner once a password change goes through", async () => {
    mocks.signInWithPassword
      .mockResolvedValueOnce({ error: null }) // current password checks out
      .mockResolvedValue({ error: { code: "invalid_credentials" } });
    await expect(changePassword({}, passwordForm("current-pass", "brand-new-pass"))).resolves.toEqual({ ok: "Password updated." });
    expect(mocks.deliverNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", kind: "password_changed", href: "/settings#account" }));
  });

  it("does not notify when the change was refused", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials" } });
    const result = await changePassword({}, passwordForm("wrong", "brand-new-pass"));
    expect(result.error).toBe("Your current password isn't right.");
    expect(mocks.deliverNotification).not.toHaveBeenCalled();
  });

  it("still reports success when the notice itself fails", async () => {
    mocks.deliverNotification.mockRejectedValue(new Error("outbox down"));
    await expect(changePassword({}, passwordForm("current-pass", "brand-new-pass"))).resolves.toEqual({ ok: "Password updated." });
    expect(mocks.reportError).toHaveBeenCalledWith("[settings] password-changed notice failed", expect.any(Object));
  });
});

describe("account setting recovery", () => {
  it("adopts an email change already pending after a lost response", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "member@drvn.test",
          new_email: "new@drvn.test",
        },
      },
      error: null,
    });

    await expect(changeEmail({}, emailForm("NEW@drvn.test"))).resolves.toEqual({
      ok: "A confirmation link is already pending for NEW@drvn.test.",
      pendingEmail: true,
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("resends a pending email confirmation only when explicitly requested", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "member@drvn.test",
          new_email: "new@drvn.test",
        },
      },
      error: null,
    });
    const form = emailForm("new@drvn.test");
    form.set("intent", "resend");

    await expect(changeEmail({}, form)).resolves.toEqual({
      ok: "Confirm the change from the link we sent to new@drvn.test.",
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({ email: "new@drvn.test" }, expect.objectContaining({ emailRedirectTo: expect.stringContaining("/confirm?next=") }));
  });

  it("reports a thrown email transport failure without claiming success", async () => {
    mocks.updateUser.mockRejectedValue(new Error("connection reset"));

    await expect(changeEmail({}, emailForm("new@drvn.test"))).resolves.toEqual({
      error: "Couldn't request that email change. Try again.",
    });
    expect(mocks.reportError).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("updates the password only after the current password is verified", async () => {
    await expect(changePassword({}, passwordForm("old-password", "new-password"))).resolves.toEqual({
      ok: "Password updated.",
    });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "member@drvn.test",
      password: "old-password",
    });
    // Auth checks it too when "require current password" is on (N20 follow-up).
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "new-password", current_password: "old-password" });
  });

  it("adopts a password already changed when the prior response was lost", async () => {
    mocks.signInWithPassword
      .mockResolvedValueOnce({ error: { code: "invalid_credentials", message: "Invalid login credentials" } })
      .mockResolvedValueOnce({ error: null });

    await expect(changePassword({}, passwordForm("old-password", "new-password"))).resolves.toEqual({
      ok: "Password updated.",
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous update error against the requested password", async () => {
    mocks.updateUser.mockResolvedValue({ error: { message: "response ended" } });

    await expect(changePassword({}, passwordForm("old-password", "new-password"))).resolves.toEqual({
      ok: "Password updated.",
    });
    expect(mocks.signInWithPassword).toHaveBeenNthCalledWith(2, {
      email: "member@drvn.test",
      password: "new-password",
    });
    expect(mocks.reportError).not.toHaveBeenCalled();
  });

  it("does not describe a verification outage as a wrong password", async () => {
    mocks.signInWithPassword.mockRejectedValue(new Error("network unavailable"));

    await expect(changePassword({}, passwordForm("old-password", "new-password"))).resolves.toEqual({
      error: "Couldn't verify your current password. Try again.",
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledOnce();
  });

  it("treats a returned retryable auth error as an unknown verification result", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      error: { code: "unexpected_failure", message: "upstream timeout", status: 503 },
    });

    await expect(changePassword({}, passwordForm("old-password", "new-password"))).resolves.toEqual({
      error: "Couldn't verify your current password. Try again.",
    });
    expect(mocks.signInWithPassword).toHaveBeenCalledOnce();
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledOnce();
  });
});

// Readiness N41: moving the sign-in email needs fresh proof it's the owner.
describe("email change re-authentication", () => {
  it("checks the typed password before asking Supabase to move the email", async () => {
    const form = emailForm("new@drvn.test");
    form.set("current_password", "typed-now");
    await expect(changeEmail({}, form)).resolves.toHaveProperty("ok");
    expect(mocks.confirmIdentity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "user-1" }), "typed-now");
    expect(mocks.confirmIdentity.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateUser.mock.invocationCallOrder[0]);
  });

  it("changes nothing without it, and says which proof to offer", async () => {
    mocks.confirmIdentity.mockResolvedValue({ ok: false, reauth: "oauth", error: "Confirm it's you with Google first, then try again." });
    await expect(changeEmail({}, emailForm("new@drvn.test"))).resolves.toEqual({
      error: "Confirm it's you with Google first, then try again.",
      reauth: "oauth",
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("answers no-change requests without asking for proof", async () => {
    await expect(changeEmail({}, emailForm("member@drvn.test"))).resolves.toEqual({ ok: "That address is already your sign-in email." });
    expect(mocks.confirmIdentity).not.toHaveBeenCalled();
  });
});

// Readiness N49: Supabase's wording stays in telemetry.
describe("account errors", () => {
  it("shows public copy for a refused email change", async () => {
    mocks.updateUser.mockResolvedValue({ error: { code: "email_exists", message: "A user with this email address has already been registered" } });
    await expect(changeEmail({}, emailForm("taken@drvn.test"))).resolves.toEqual({
      error: "There's already an account with that email. Sign in instead.",
    });
    mocks.updateUser.mockResolvedValue({ error: { code: "unexpected_failure", message: "pq: deadlock detected" } });
    const result = await changeEmail({}, emailForm("other@drvn.test"));
    expect(result.error).toBe("That didn't go through. Try again in a moment.");
    expect(mocks.reportError).toHaveBeenCalledWith("[auth] settings email change failed", expect.objectContaining({ userId: "user-1" }));
  });

  it("shows public copy for a refused password change", async () => {
    mocks.signInWithPassword
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValue({ error: { code: "invalid_credentials" } });
    mocks.updateUser.mockResolvedValue({ error: { code: "weak_password", message: "Password should contain at least one character of each: abc" } });
    await expect(changePassword({}, passwordForm("current-pass", "brand-new-pass"))).resolves.toEqual({
      error: "Pick a stronger password — longer is better.",
    });
  });
});

// Readiness N45: a Google-only member has a way to set a password.
describe("set-password link", () => {
  it("emails the account's own address a link that lands on the reset form", async () => {
    await expect(sendPasswordSetupLink()).resolves.toEqual({ ok: "We've emailed a link to member@drvn.test. Open it to set a password." });
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("member@drvn.test", {
      redirectTo: `https://drvn.example/callback?next=${encodeURIComponent("/login/reset")}`,
    });
    expect(mocks.allowAction).toHaveBeenCalledWith(expect.objectContaining({ action: "password-setup-link" }), "user:user-1");
  });

  it("is throttled per member and never leaks provider wording", async () => {
    mocks.allowAction.mockResolvedValue(false);
    await expect(sendPasswordSetupLink()).resolves.toEqual({ error: "Too many attempts. Wait a minute and try again." });
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();

    mocks.allowAction.mockResolvedValue(true);
    mocks.resetPasswordForEmail.mockResolvedValue({ error: { code: "unexpected_failure", message: "smtp: 550 relay denied" } });
    const result = await sendPasswordSetupLink();
    expect(result.error).not.toContain("smtp");
  });
});

// OS-W12 follow-up (N20 at the Auth boundary): Auth is handed the current
// password, and its own refusal reads as ours.
describe("password change at the Auth boundary", () => {
  it("passes the current password to Auth with the new one", async () => {
    mocks.signInWithPassword
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValue({ error: { code: "invalid_credentials" } });
    await changePassword({}, passwordForm("current-pass", "brand-new-pass"));
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "brand-new-pass", current_password: "current-pass" });
  });

  it("explains Auth's current-password refusal without its wording", async () => {
    mocks.signInWithPassword
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValue({ error: { code: "invalid_credentials" } });
    mocks.updateUser.mockResolvedValue({ error: { code: "current_password_mismatch", message: "Current password required when setting new password." } });
    await expect(changePassword({}, passwordForm("current-pass", "brand-new-pass"))).resolves.toEqual({
      error: "Your current password isn't right.",
    });
    expect(mocks.deliverNotification).not.toHaveBeenCalled();
  });
});
