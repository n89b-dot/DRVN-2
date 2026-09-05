import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { cleanupE2eUsers, makeUser, signUp } from "./helpers";

test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce" }); });

/** Applicable WCAG A/AA rules fail at every impact level. Automated scans
 * complement the separately recorded manual/device acceptance matrix. */
export async function assertAccessible(page: Page, label: string) {
  await expect.poll(() => page.locator("main [data-reveal]").evaluateAll(elements => elements.every(element => Number(getComputedStyle(element).opacity) >= 0.999)), {message:"revealed content has settled"}).toBe(true);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map(v => ({id:v.id, impact:v.impact, nodes:v.nodes.map(n => ({target:n.target, summary:n.failureSummary}))})), `WCAG A/AA violations: ${label}`).toEqual([]);
}

const PAGES = ["/", "/marketplace", "/login", "/signup", "/explore"];

for (const path of PAGES) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await assertAccessible(page, path);
  });
}

test("keyboard-only: reach and operate signup", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByLabel(/^email$/i)).toBeVisible();
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

test("authenticated account, settings and garage dialog meet automated WCAG A/AA", async ({page}) => {
  const user=makeUser("a11y-member",Date.now());
  await signUp(page,user);
  for (const path of ["/home","/settings","/garage","/orders","/selling"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await assertAccessible(page,path);
  }
  await page.goto("/garage");
  const trigger=page.getByRole("button",{name:/add a car|add car/i}).first();
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await assertAccessible(page,"garage dialog");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
test.afterAll(async()=>{await cleanupE2eUsers();});
