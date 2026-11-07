import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.hoisted(() => vi.fn());
const profile = vi.hoisted(() => ({ username: null as string | null }));
// The signed-in user after verification, or null for a browser with no session.
const viewer = vi.hoisted(() => ({ user: { id: "user-1" } as { id: string; new_email?: string } | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { verifyOtp, getUser: async () => ({ data: { user: viewer.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: profile.username } }) }) }) }),
  }),
}));

import { GET, POST } from "./route";

const SITE = "https://drvn.example";
beforeEach(() => {
  vi.clearAllMocks();
  profile.username = null;
  viewer.user = { id: "user-1" };
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

// A member changing their sign-in email (readiness 53): the link used to carry
// Supabase's PKCE address and land on the home page with no word of what had
// happened. It now carries a token hash and comes back to Settings.
describe("email change links land on Settings", () => {
  it("offers the confirm page for an email_change link and takes Settings out of the return address", async () => {
    const redirectTo = encodeURIComponent(`${SITE}/confirm?next=${encodeURIComponent("/settings?changed=email")}`);
    const response = await GET(new Request(`${SITE}/confirm?token_hash=abc&type=email_change&redirect_to=${redirectTo}`));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("Confirm the change");
    expect(html).toContain('name="type" value="email_change"');
    expect(html).toContain('name="flow" value="email_change"');
    expect(html).toContain('name="next" value="/settings?changed=email"');
  });

  it("falls back to Settings when the return address is missing, off-site or not Settings", async () => {
    const bare = await (await GET(new Request(`${SITE}/confirm?token_hash=abc&type=email_change`))).text();
    expect(bare).toContain('name="next" value="/settings?changed=email"');
    const offsite = encodeURIComponent("https://evil.example/confirm?next=/settings?changed=email");
    const stolen = await (await GET(new Request(`${SITE}/confirm?token_hash=abc&type=email_change&redirect_to=${offsite}`))).text();
    expect(stolen).toContain('name="next" value="/settings?changed=email"');
    const elsewhere = await (await GET(new Request(`${SITE}/confirm?token_hash=abc&type=email_change&next=/orders`))).text();
    expect(elsewhere).toContain('name="next" value="/settings?changed=email"');
    // Only Settings or a page under it: a lookalike path is not Settings.
    const lookalike = await (await GET(new Request(`${SITE}/confirm?token_hash=abc&type=email_change&next=/settings-phish`))).text();
    expect(lookalike).toContain('name="next" value="/settings?changed=email"');
    const under = await (await GET(new Request(`${SITE}/confirm?token_hash=abc&type=email_change&next=/settings/account`))).text();
    expect(under).toContain('name="next" value="/settings/account"');
  });

  it("the first of the two links, in a browser with no session, lands on the public result page", async () => {
    // Secure email change: the first link verifies with no session and no user.
    verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    viewer.user = null;
    const response = await POST(post({ token_hash: "first", type: "email_change", flow: "email_change", next: "/settings?changed=email" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${SITE}/email-change?step=pending`);
  });

  it("the first link in a signed-in browser still says one link is confirmed", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    viewer.user = { id: "user-1", new_email: "new@drvn.test" };
    const response = await POST(post({ token_hash: "first", type: "email_change", flow: "email_change", next: "/settings?changed=email" }));
    expect(response.headers.get("location")).toBe(`${SITE}/email-change?step=pending`);
  });

  it("the second link, opened in a browser with no session, signs in and lands on Settings", async () => {
    // The completing verification returns the session; the client stores it.
    verifyOtp.mockResolvedValue({ data: { user: { id: "user-1" }, session: { access_token: "t" } }, error: null });
    viewer.user = null;
    const response = await POST(post({ token_hash: "second", type: "email_change", flow: "email_change", next: "/settings?changed=email" }));
    expect(response.headers.get("location")).toBe(`${SITE}/settings?changed=email`);
  });

  it("verifies the token as an email change and lands on Settings with the notice", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "user-1" }, session: { access_token: "t" } }, error: null });
    const response = await POST(post({ token_hash: "abc", type: "email_change", flow: "email_change", next: "/settings?changed=email" }));
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "email_change" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${SITE}/settings?changed=email`);
  });

  it("sends a failed email-change verification to the sign-in page like every other link", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    const response = await POST(post({ token_hash: "abc", type: "email_change", flow: "email_change", next: "/settings?changed=email" }));
    expect(response.headers.get("location")).toContain("/login?message=auth-error");
  });
});
