import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const viewer = vi.hoisted(() => ({ current: null as { id: string } | null }));
vi.mock("@/lib/supabase/page-context", () => ({ getViewer: async () => viewer.current }));

import EmailChangeResultPage from "./page";

async function render(step?: string) {
  return renderToStaticMarkup(await EmailChangeResultPage({ searchParams: Promise.resolve({ step }) }));
}

// Where an email-change link lands when it signed no one in (readiness 53):
// the first of the two links says so publicly instead of bouncing to Login.
describe("email change result page", () => {
  beforeEach(() => {
    viewer.current = null;
  });

  it("tells a signed-out visitor the first link worked, and offers sign-in back to Settings", async () => {
    const html = await render("pending");
    expect(html).toContain("One link confirmed.");
    expect(html).toContain("the other address");
    expect(html).toContain(`href="/login?next=${encodeURIComponent("/settings?changed=email")}"`);
    expect(html).not.toContain('href="/settings?changed=email"');
  });

  it("offers Settings to a visitor who is signed in", async () => {
    viewer.current = { id: "user-1" };
    const html = await render("pending");
    expect(html).toContain('href="/settings?changed=email"');
    expect(html).toContain("Go to Settings");
  });

  it("says the change is complete on step=done", async () => {
    expect(await render("done")).toContain("Sign-in email updated.");
  });
});
