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
    // The offer page links into the person's conversation; an offer id opens
    // it (and redirects to the conversation once the first message exists).
    await page.goto(`/messages/${offer.data.id}`);
    const input = page.getByRole("textbox", { name: /^Message / });
    const body = `Lost response ${randomUUID()}`;
    await input.fill(body);
    let interrupted = false;
    await page.route(`**/messages/${offer.data.id}`, async (route) => {
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
    await expect(page.getByRole("textbox", { name: /^Message / })).toHaveValue("");
    await expect(page.getByText(body, { exact: true })).toBeVisible();
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

test("order-thread composer preserves a draft and retries a committed response loss once", async ({ page }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Order message fixtures are restricted to the isolated local stack");
  test.setTimeout(120_000);
  const admin = fixtureAdmin();
  const users: string[] = [];
  const password = `Order-message-${randomUUID()}!`;
  const buyerEmail = `e2e-order-message-${randomUUID()}@drvn.test`;
  try {
    for (const address of [buyerEmail, `e2e-order-message-seller-${randomUUID()}@drvn.test`]) {
      const result = await admin.auth.admin.createUser({ email: address, password, email_confirm: true });
      if (result.error) throw result.error;
      users.push(result.data.user.id);
      const named = await admin.from("profiles").update({ username: `ordmsg${randomUUID().replaceAll("-", "").slice(0, 17)}` }).eq("id", result.data.user.id);
      if (named.error) throw named.error;
    }
    const listing = await admin.from("listings").insert({ seller_id: users[1], title: "Order message recovery fixture", category: "performance", price_cents: 10000, shipping_cents: 0, currency: "USD", status: "sold" }).select("id").single();
    if (listing.error) throw listing.error;
    const order = await admin.from("orders").insert({ buyer_id: users[0], seller_id: users[1], status: "paid", subtotal_cents: 10000, shipping_cents: 0, platform_fee_cents: 1000, total_cents: 10000, currency: "USD" }).select("id").single();
    if (order.error) throw order.error;
    const item = await admin.from("order_items").insert({ order_id: order.data.id, listing_id: listing.data.id, title: "Order message recovery fixture", price_cents: 10000, shipping_cents: 0 });
    if (item.error) throw item.error;

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(buyerEmail);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    await page.goto(`/messages/${order.data.id}`);
    const input = page.getByRole("textbox", { name: /^Message / });
    const body = `Order response lost ${randomUUID()}`;
    await input.fill(body);
    let interrupted = false;
    await page.route(`**/messages/${order.data.id}`, async route => {
      if (!interrupted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        interrupted = true;
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: /send/i }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Your draft is still here");
    await expect(input).toHaveValue(body);
    await page.getByRole("button", { name: /send/i }).click();
    await expect(page.getByRole("textbox", { name: /^Message / })).toHaveValue("");
    const rows = await admin.from("messages").select("id").eq("order_id", order.data.id).eq("body", body);
    if (rows.error) throw rows.error;
    expect(rows.data).toHaveLength(1);
    await page.reload();
    await expect(page.getByText(body, { exact: true })).toHaveCount(1);
  } finally {
    for (const id of users.reverse()) await cleanupFixtureUser(id);
  }
});
