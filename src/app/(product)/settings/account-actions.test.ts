import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  revalidatePath: vi.fn(),
  reportError: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  deliverNotification: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/notifications/deliver", () => ({ deliverNotification: mocks.deliverNotification }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: mocks.getUser,
      signInWithPassword: mocks.signInWithPassword,
      updateUser: mocks.updateUser,
    },
  }),
}));

import { changeEmail, changePassword } from "./account-actions";

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
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "new-password" });
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
