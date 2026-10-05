import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.hoisted(() => vi.fn());
const profile = vi.hoisted(() => ({ username: null as string | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { verifyOtp, getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: profile.username } }) }) }) }),
  }),
}));

import { GET, POST } from "./route";

const SITE = "https://drvn.example";
beforeEach(() => {
  vi.clearAllMocks();
  profile.username = null;
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  verifyOtp.mockResolvedValue({ error: null });
});

function post(fields: Record<string, string>) {
  return new Request(`${SITE}/confirm`, {
    method: "POST",
    headers: { origin: SITE, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

// A guest's order link arrives as a magic link, or — once "Confirm email" is
// on — as the Confirm signup email (type "email"). Both must open the orders.
describe("guest order links", () => {
  it.each(["magiclink", "email"])("renders the one-click page for type=%s and carries the type", async (type) => {
    const response = await GET(new Request(`${SITE}/confirm?token_hash=abc&type=${type}&next=/orders/1`));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`name="type" value="${type}"`);
  });

  it("refuses any other link type", async () => {
    const response = await GET(new Request(`${SITE}/confirm?token_hash=abc&type=invite`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?message=auth-error");
  });

  it.each(["magiclink", "email"])("verifies a %s token as that type", async (type) => {
    const response = await POST(post({ token_hash: "abc", next: "/orders/1", type }));
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type });
    expect(response.headers.get("location")).toBe(`${SITE}/orders/1`);
  });

  it("treats a form without a type as a magic link (pages rendered before the field existed)", async () => {
    await POST(post({ token_hash: "abc", next: "/orders" }));
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "magiclink" });
  });

  it("never verifies a forged type", async () => {
    const response = await POST(post({ token_hash: "abc", type: "invite" }));
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("/login?message=auth-error");
  });
});

// Reset and signup links used to carry a PKCE code only the requesting
// browser could exchange. They now carry a token hash, verified here, so the
// email can be opened on any device.
describe("member links work in any browser", () => {
  it("offers the password form for a recovery link, whatever destination it carries", async () => {
    const response = await GET(new Request(`${SITE}/confirm?token_hash=abc&type=recovery&next=/orders`));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("Choose a new password");
    expect(html).toContain('name="next" value="/login/reset"');
  });

  it("verifies a recovery token and lands on the reset form", async () => {
    const response = await POST(post({ token_hash: "abc", type: "recovery", next: "/orders", flow: "recovery" }));
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "recovery" });
    expect(response.headers.get("location")).toBe(`${SITE}/login/reset`);
  });

  it("carries a signup's destination out of the address Supabase was asked to return to", async () => {
    const redirectTo = encodeURIComponent(`${SITE}/callback?next=${encodeURIComponent("/listings/42")}`);
    const response = await GET(new Request(`${SITE}/confirm?token_hash=abc&type=email&flow=signup&redirect_to=${redirectTo}`));
    const html = await response.text();
    expect(html).toContain("Confirm and continue");
    expect(html).toContain('name="next" value="/listings/42"');
    expect(html).toContain('name="flow" value="signup"');
  });

  it("never takes a destination from another site's address", async () => {
    const redirectTo = encodeURIComponent("https://evil.example/callback?next=/listings/42");
    const html = await (await GET(new Request(`${SITE}/confirm?token_hash=abc&type=email&flow=signup&redirect_to=${redirectTo}`))).text();
    expect(html).toContain('name="next" value=""');
    const offsite = encodeURIComponent(`${SITE}/callback?next=//evil.example`);
    const second = await (await GET(new Request(`${SITE}/confirm?token_hash=abc&type=email&flow=signup&redirect_to=${offsite}`))).text();
    expect(second).toContain('name="next" value=""');
  });

  it("sends a newly confirmed account to pick its handle, keeping the destination", async () => {
    const response = await POST(post({ token_hash: "abc", type: "email", flow: "signup", next: "/listings/42" }));
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "email" });
    expect(response.headers.get("location")).toBe(`${SITE}/onboarding?next=${encodeURIComponent("/listings/42")}`);
  });

  it("sends an account that already has a handle to its destination, or home", async () => {
    profile.username = "kaito";
    const withNext = await POST(post({ token_hash: "abc", type: "email", flow: "signup", next: "/listings/42" }));
    expect(withNext.headers.get("location")).toBe(`${SITE}/listings/42`);
    const without = await POST(post({ token_hash: "abc", type: "email", flow: "signup", next: "" }));
    expect(without.headers.get("location")).toBe(`${SITE}/home`);
  });

  it("keeps a guest's order link going to their orders", async () => {
    const response = await POST(post({ token_hash: "abc", type: "email", next: "/orders", flow: "orders" }));
    expect(response.headers.get("location")).toBe(`${SITE}/orders`);
  });
});
