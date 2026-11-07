import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { assertAccessible } from "./accessibility";
import { createDiscoveryFixture } from "./fixtures";
import { cleanupE2eUsers, makeUser, signUp } from "./helpers";

test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce" }); });

const PAGES = ["/", "/marketplace", "/login", "/signup", "/explore"];

for (const path of PAGES) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await assertAccessible(page, path);
  });
}

/**
 * The night sheet is a token remap, so a palette change lands everywhere at
 * once — and until the September 2026 cooler-paper switch (PRD §3) nothing in
 * the suite ever rendered it. `colorScheme: "dark"` doesn't reach it either:
 * the theme is a cookie, and `prefers-color-scheme` is only the first-visit
 * default. This sets the cookie and runs the same axe pass, so a future
 * retune can't quietly drop a pairing under 4.5:1.
 */
for (const path of PAGES) {
  test(`axe (night): ${path}`, async ({ page, baseURL }) => {
    await page.context().addCookies([
      { name: "ls-theme", value: "night", url: baseURL ?? "http://localhost:3000" },
    ]);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await assertAccessible(page, `${path} (night)`);
  });
}

test("live text uses its accessible token on the recessed surface", async ({ page }) => {
  await page.goto("/login");
  const sample = page.locator("#live-text-surface-regression");
  await page.locator("body").evaluate((body) => {
    const element = document.createElement("p");
    element.id = "live-text-surface-regression";
    element.className = "text-live";
    element.textContent = "Live status requires readable contrast";
    element.style.backgroundColor = "var(--paper-deep)";
    element.style.fontSize = "12px";
    element.style.fontWeight = "400";
    body.append(element);
  });

  await expect(sample).toHaveCSS("color", "rgb(168, 36, 16)");
  await expect(sample).toHaveCSS("background-color", "rgb(229, 226, 216)");
  const contrast = await sample.evaluate((element) => {
    const channel = (value: number) => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };
    const luminance = (value: string) => {
      const [red, green, blue] = value.match(/\d+/g)!.slice(0, 3).map(Number);
      return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
    };
    const style = getComputedStyle(element);
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await assertAccessible(page, "live text painted on recessed surface");
});

test("keyboard-only signup order and announced authentication error", async ({ page }) => {
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

  // Native signup constraints are announced by the browser. Exercise the
  // application's server-auth failure and live region through login.
  await page.goto("/login");
  await page.getByLabel(/^email$/i).fill(`missing-${Date.now()}@example.test`);
  await page.getByLabel(/^password$/i).fill("valid-but-incorrect-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  const error = page.getByRole("alert").filter({ hasText: /email and password don't match/i });
  await expect(error, "invalid login feedback is announced").toBeVisible();
  await assertAccessible(page, "login server-auth error");
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
  // Measure the dialog at rest: mid fade-in, its labels blend into the
  // ground (e.g. --dim at 87% opacity reads 4.37:1) and axe reports the blend.
  await expect.poll(() => page.getByRole("dialog").evaluate((el) => {
    let opacity = 1;
    // The Dialog fades its inner .dialogbox (dialog.tsx), so start there.
    for (let node: Element | null = el.querySelector(".dialogbox") ?? el; node; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity);
    }
    return opacity;
  })).toBe(1);
  await assertAccessible(page,"garage dialog");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("authenticated cart and checkout meet automated WCAG A/AA at desktop and 400% reflow width", async ({ page }) => {
  const listing = await createDiscoveryFixture();
  const user = makeUser("a11y-checkout", Date.now());
  try {
    await signUp(page, user);
    await page.goto(listing.listingPath);
    await page.getByRole("button", { name: /add to cart/i }).click();
    await page.getByRole("link", { name: /in cart.*view cart/i }).click();
    await expect(page).toHaveURL(/\/cart/);
    await assertAccessible(page, "authenticated cart");
    await page.getByRole("link", { name: /proceed to checkout/i }).first().click();
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.locator("main")).toBeVisible();
    await assertAccessible(page, "authenticated checkout");

    // A 320 CSS-pixel viewport represents 400% zoom at a 1280px desktop
    // viewport. The scan complements the existing explicit overflow checks.
    await page.setViewportSize({ width: 320, height: 800 });
    await assertAccessible(page, "authenticated checkout at 400% reflow width");
  } finally {
    await listing.cleanup();
  }
});
/**
 * The agent's surfaces (readiness 74): /agent with its chat, the desktop side
 * panel open beside a page, the phone bottom bar, and an offer page. The
 * agent steps start closed (20261024100000), so this opens them through the
 * isolated local stack's database, like e2e/buyer-agent.spec.ts — and is
 * restricted to that stack the same way.
 */
test.describe("agent surfaces meet automated WCAG A/AA", () => {
  test.setTimeout(180_000);
  let db: Client;

  test.beforeAll(async () => {
    test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Agent fixtures are restricted to the isolated local stack");
    db = new Client({ host: "127.0.0.1", port: 54322, user: "supabase_admin", password: "postgres", database: "postgres" });
    await db.connect();
    await db.query("update public.agent_beta_steps set open = true where step in ('seller', 'buyer', 'chat')");
  });
  test.afterAll(async () => {
    if (db) await db.end();
  });

  test("/agent, the side panel, the bottom bar and an offer page", async ({ page }) => {
    const listing = await createDiscoveryFixture();
    const user = makeUser("a11y-agent", Date.now());
    try {
      await signUp(page, user);

      // The Agent tab, with the chat's live thread and composer.
      await page.goto("/agent");
      await expect(page.locator("main")).toBeVisible();
      await assertAccessible(page, "/agent");

      // The side panel beside a page, open (desktop width).
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(listing.listingPath);
      await page.getByRole("button", { name: "Ask your agent" }).or(page.getByRole("link", { name: "Ask your agent" })).first().click();
      const panel = page.getByRole("complementary", { name: "Your agent" });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("heading", { name: /Agent/ })).toBeFocused();
      await assertAccessible(page, "listing with the agent panel open");

      // Narrowed to a phone with the panel still open: the bottom bar must
      // come back (the panel's hidden composer used to hide it).
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/home");
      await expect(page.locator(".bnav")).toBeVisible();
      await assertAccessible(page, "/home with the bottom bar");

      // An offer page, as the buyer who made it.
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(listing.listingPath);
      await page.getByRole("button", { name: "Make an offer" }).first().click();
      await page.getByLabel("Your offer").fill("90");
      await page.getByRole("button", { name: /send offer/i }).click();
      await expect(page.getByText(/Offer sent/)).toBeVisible();
      await page.goto(listing.listingPath);
      await page.getByRole("link", { name: /view offer/i }).click();
      await expect(page).toHaveURL(/\/offers\//);
      await expect(page.locator("main")).toBeVisible();
      await assertAccessible(page, "offer page");
    } finally {
      await listing.cleanup();
    }
  });
});

test.afterAll(async()=>{await cleanupE2eUsers();});
