import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  getUser: vi.fn(),
  refresh: vi.fn(),
  reportError: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.cookieSet }) }));
vi.mock("@/lib/cookie-security", () => ({ secureCookies: () => false }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));

import { saveAnalyticsConsent } from "./analytics-consent-actions";

function consent(enabled: boolean) {
  const form = new FormData();
  if (enabled) form.set("analytics", "on");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mocks.rpc.mockResolvedValue({ error: null });
});

describe("analytics consent persistence", () => {
  it.each([
    { enabled: true, rpcValue: true, cookieValue: "v1:yes" },
    { enabled: false, rpcValue: false, cookieValue: "v1:no" },
  ])("persists the $enabled preference before updating this browser", async ({ enabled, rpcValue, cookieValue }) => {
    const order: string[] = [];
    mocks.rpc.mockImplementation(async () => {
      order.push("account");
      return { error: null };
    });
    mocks.cookieSet.mockImplementation(() => order.push("browser"));

    await expect(saveAnalyticsConsent({}, consent(enabled))).resolves.toEqual({
      ok: "Privacy preference saved.",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("set_analytics_consent", { p_allowed: rpcValue });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "drvn_analytics_consent",
      cookieValue,
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" })
    );
    expect(order).toEqual(["account", "browser"]);
    expect(mocks.refresh).toHaveBeenCalledWith("/settings");
  });

  it("does not claim success or update the cookie after a database failure", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "database unavailable" } });

    await expect(saveAnalyticsConsent({}, consent(true))).resolves.toEqual({
      error: "Privacy preference could not be saved. Try again.",
    });
    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("reports the account/browser split honestly when the cookie write fails", async () => {
    mocks.cookieSet.mockImplementation(() => {
      throw new Error("cookies blocked");
    });

    const result = await saveAnalyticsConsent({}, consent(true));
    expect(result.error).toContain("account preference was saved");
    expect(result.error).toContain("Try again");
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("requires a current session before changing either store", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    expect((await saveAnalyticsConsent({}, consent(true))).error).toContain("Sign in again");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
