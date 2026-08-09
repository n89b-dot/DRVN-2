import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Automated accessibility floor: axe scans of the public surfaces plus a
 * keyboard-only smoke of the signup entry. Serious/critical violations fail;
 * moderate/minor are reported in the test output for triage without blocking.
 * Signed-in journeys are covered by the golden path; this file needs no
 * account, so it runs anywhere the app serves.
 */

const PAGES = ["/", "/marketplace", "/login", "/signup", "/explore"];

for (const path of PAGES) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      // Dev-mode overlays (Next dev tools) aren't the product.
      .exclude("[data-nextjs-dev-tools-button]")
      .exclude("nextjs-portal")
      .analyze();

    const blocking = results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? "")
    );
    const advisory = results.violations.filter((v) => !blocking.includes(v));
    if (advisory.length) {
      console.log(
        `[a11y] ${path} advisory:`,
        advisory.map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}`).join(", ")
      );
    }
    expect(
      blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      `serious/critical axe violations on ${path}`
    ).toEqual([]);
  });
}

test("keyboard-only: reach and operate signup", async ({ page }) => {
  await page.goto("/signup");
  // Tab until the email field takes focus — no pointer involved.
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    const isEmail = await page.evaluate(
      () => document.activeElement?.getAttribute("name") === "email"
    );
    if (isEmail) break;
  }
  await expect(
    page.locator(":focus[name='email']"),
    "email input must be reachable by Tab alone"
  ).toHaveCount(1);
  await page.keyboard.type("keyboard-only@example.test");
  await page.keyboard.press("Tab");
  await expect(
    page.locator(":focus[name='password']"),
    "password follows email in the tab order"
  ).toHaveCount(1);
});
