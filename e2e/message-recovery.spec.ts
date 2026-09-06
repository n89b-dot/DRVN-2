import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

test("message draft survives a lost committed response and retry inserts only once", async ({ page }) => {
  test.setTimeout(120_000);
  const admin = fixtureAdmin();
  const users: string[] = [];
  const password = `Message-${randomUUID()}!`;
  const email = `e2e-message-${randomUUID()}@drvn.test`;
  try {
    for (const address of [email, `e2e-message-seller-${randomUUID()}@drvn.test`]) {
      const result = await admin.auth.admin.createUser({ email: address, password, email_confirm: true });
      if (result.error) throw result.error;
      users.push(result.data.user.id);
      const named = await admin.from("profiles").update({ username: `msg${randomUUID().replaceAll("-", "").slice(0, 18)}` }).eq("id", result.data.user.id);
      if (named.error) throw named.error;
    }
    const listing = await admin.from("listings").insert({ seller_id: users[1], title: "Message recovery fixture", category: "performance", price_cents: 10000, shipping_cents: 0, currency: "USD", status: "active" }).select("id").single();
    if (listing.error) throw listing.error;
    const offer = await admin.from("offers").insert({ listing_id: listing.data.id, buyer_id: users[0], amount_cents: 9000 }).select("id").single();
    if (offer.error) throw offer.error;
    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    await page.goto(`/offers/${offer.data.id}`);
    const input = page.getByRole("textbox", { name: "Message the other party" });
    const body = `Lost response ${randomUUID()}`;
    await input.fill(body);
    let interrupted = false;
    await page.route(`**/offers/${offer.data.id}`, async (route) => {
      if (!interrupted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        interrupted = true;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: /send/i }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Your draft is still here");
    await expect(input).toHaveValue(body);
    await page.getByRole("button", { name: /send/i }).dblclick();
    await expect(input).toHaveValue("");
    await expect(page.getByRole("main").getByRole("alert").filter({ hasText: /^Sent\.$/ })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert").filter({ hasText: "Your draft is still here" })).toHaveCount(0);
    const rows = await admin.from("messages").select("id").eq("offer_id", offer.data.id).eq("body", body);
    if (rows.error) throw rows.error;
    expect(rows.data).toHaveLength(1);
    await page.reload();
    await expect(page.getByText(body, { exact: true })).toHaveCount(1);
  } finally {
    for (const id of users.reverse()) await cleanupFixtureUser(id);
  }
});
