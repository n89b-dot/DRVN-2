import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { verifyOtp } }) }));

import { GET, POST } from "./route";

const SITE = "https://drvn.example";
beforeEach(() => {
  vi.clearAllMocks();
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
    const response = await GET(new Request(`${SITE}/confirm?token_hash=abc&type=recovery`));
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
    const response = await POST(post({ token_hash: "abc", type: "recovery" }));
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("/login?message=auth-error");
  });
});
