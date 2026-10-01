import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

// RR-16: live delivery is proven by subscription, not by the 20-second
// fallback refresh. The Messages badge has no polling at all, and every wait
// below is shorter than the fallback, so only a working subscription passes.
const LIVE = { timeout: 10_000 };

async function member(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(/\/home/);
  return page;
}

test("a message reaches the recipient live — badge and open thread — and nobody else", async ({ browser }) => {
  test.skip(
    process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation",
    "Realtime fixtures are restricted to the isolated local stack"
  );
  test.setTimeout(120_000);
  const admin = fixtureAdmin();
  const password = `Realtime-${randomUUID()}!`;
  const emails = ["buyer", "seller", "bystander"].map((r) => `e2e-realtime-${r}-${randomUUID()}@drvn.test`);
  const users: string[] = [];
  try {
    for (const email of emails) {
      const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (result.error) throw result.error;
      users.push(result.data.user.id);
      const named = await admin
        .from("profiles")
        .update({ username: `rt${randomUUID().replaceAll("-", "").slice(0, 18)}`, display_name: "Realtime fixture" })
        .eq("id", result.data.user.id);
      if (named.error) throw named.error;
    }
    const [buyer, seller] = users;
    const listing = await admin
      .from("listings")
      .insert({ seller_id: seller, title: "Realtime fixture", category: "performance", price_cents: 10000, shipping_cents: 0, currency: "USD", status: "active" })
      .select("id")
      .single();
    if (listing.error) throw listing.error;
    const offer = await admin.from("offers").insert({ listing_id: listing.data.id, buyer_id: buyer, amount_cents: 9000 }).select("id").single();
    if (offer.error) throw offer.error;

    const buyerPage = await member(browser, emails[0], password);
    const bystanderPage = await member(browser, emails[2], password);
    const sellerPage = await member(browser, emails[1], password);
    const badge = (page: Page) => page.getByRole("link", { name: /^Messages, \d+ conversations? with unread/ });
    await expect(badge(buyerPage)).toHaveCount(0);

    // 1. The seller writes; the buyer's badge appears on /home without navigation.
    await sellerPage.goto(`/messages/${offer.data.id}`);
    const composer = sellerPage.getByRole("textbox", { name: /^Message / });
    await composer.fill("Is Saturday good for pickup?");
    await sellerPage.getByRole("button", { name: /send/i }).click();
    await expect(composer).toHaveValue("");
    await expect(badge(buyerPage)).toHaveAccessibleName(/Messages, 1 conversation with unread/, LIVE);

    // 2. The buyer opens the thread; the seller's next message arrives live.
    await buyerPage.goto(`/messages/${offer.data.id}`);
    await expect(buyerPage.locator(".convthread").getByText("Is Saturday good for pickup?")).toBeVisible();
    await composer.fill("Or Sunday morning");
    await sellerPage.getByRole("button", { name: /send/i }).click();
    await expect(buyerPage.locator(".convthread").getByText("Or Sunday morning")).toBeVisible(LIVE);
    await expect(buyerPage.locator(".convthread").getByText("Or Sunday morning")).toHaveCount(1);

    // 3. Reading it clears the buyer's badge live too.
    await expect(badge(buyerPage)).toHaveCount(0, LIVE);

    // 4. Someone outside the conversation never sees it.
    await bystanderPage.reload();
    await expect(badge(bystanderPage)).toHaveCount(0);
    await expect(bystanderPage.getByText("Is Saturday good for pickup?")).toHaveCount(0);
  } finally {
    for (const id of users.reverse()) await cleanupFixtureUser(id);
  }
});
