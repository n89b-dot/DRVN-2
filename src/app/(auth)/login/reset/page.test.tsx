import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims } }) }));
vi.mock("@/app/(auth)/actions", () => ({ updatePassword: vi.fn() }));

import ResetPasswordPage from "./page";

const now = () => Math.floor(Date.now() / 1000);
const render = async () => renderToStaticMarkup(await ResetPasswordPage());

beforeEach(() => getClaims.mockReset());

// Readiness N20: the form only renders for a session opened from a reset link.
describe("reset password page", () => {
  it("shows the form to a session opened from a reset link just now", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1", amr: [{ method: "otp", timestamp: now() - 60 }] } }, error: null });
    const html = await render();
    expect(html).toContain("Set a new");
    expect(html).toContain('name="password"');
  });

  it("offers a reset link or Settings, not the form, to an ordinary signed-in session", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1", amr: [{ method: "password", timestamp: now() - 60 }] } }, error: null });
    const html = await render();
    expect(html).not.toContain('name="password"');
    expect(html).toContain('href="/login/forgot"');
    expect(html).toContain('href="/settings#account"');
  });

  it("says the link expired when there is no session", async () => {
    getClaims.mockResolvedValue({ data: null, error: { message: "Auth session missing!" } });
    const html = await render();
    expect(html).toContain("expired.");
    expect(html).not.toContain('name="password"');
  });
});
