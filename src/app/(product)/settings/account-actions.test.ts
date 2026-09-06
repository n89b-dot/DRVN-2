import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  revalidatePath: vi.fn(),
  reportError: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
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
    expect(mocks.updateUser).toHaveBeenCalledWith({ email: "new@drvn.test" });
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
