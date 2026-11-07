import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: () => async () => [] }));
vi.mock("next/navigation", () => ({ usePathname: () => "/login" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/marketplace/query", () => ({ hydrateListingCards: vi.fn() }));

import AuthLayout from "./layout";

// Readiness N50: login and sign-up had no main landmark.
describe("auth layout landmarks", () => {
  it("renders exactly one main landmark, around the page content", () => {
    const html = renderToStaticMarkup(
      <AuthLayout>
        <h1>Welcome back.</h1>
      </AuthLayout>
    );
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toMatch(/<main id="main" class="authcard"><h1>Welcome back\.<\/h1><\/main>/);
    // The navigation plates stay outside it.
    expect(html.indexOf('aria-label="DRVN home"')).toBeLessThan(html.indexOf("<main"));
  });

  it("no page under the layout adds a main of its own", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(__dirname);
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) && entry.name !== "layout.tsx") pages.push(full);
      }
    };
    walk(root);
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) expect(readFileSync(page, "utf8"), page).not.toMatch(/<main\b/);
  });
});
