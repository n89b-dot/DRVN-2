import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

test("accepted-offer checkout retries a lost payment response with one order and frozen address", async ({ page }) => {
  test.setTimeout(120_000);
  const admin = fixtureAdmin();
  const users: string[] = [];
  const password = `Offer-${randomUUID()}!`;
  const buyerEmail = `e2e-offer-recovery-${randomUUID()}@drvn.test`;
  try {
    for (const email of [buyerEmail, `e2e-offer-seller-${randomUUID()}@drvn.test`]) {
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw created.error;
      users.push(created.data.user.id);
      const named = await admin.from("profiles").update({ username: `offer${randomUUID().replaceAll("-", "").slice(0, 18)}`, payouts_enabled: true }).eq("id", created.data.user.id);
      if (named.error) throw named.error;
    }
    const listing = await admin.from("listings").insert({ seller_id: users[1], title: "Accepted offer recovery fixture", category: "performance", price_cents: 10000, shipping_cents: 500, currency: "USD", status: "active" }).select("id").single();
    if (listing.error) throw listing.error;
    const offer = await admin.from("offers").insert({ listing_id: listing.data.id, buyer_id: users[0], amount_cents: 9000 }).select("id").single();
    if (offer.error) throw offer.error;
    const accepted = await admin.rpc("offer_accept_begin", { p_offer_id: offer.data.id, p_seller_id: users[1] });
    if (accepted.error) throw accepted.error;
    expect(accepted.data).toBeTruthy();
    const orderId = accepted.data!;
    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(buyerEmail);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    await page.goto(`/orders/${orderId}/checkout`);
    await page.getByLabel(/^name$/i).fill("Offer buyer");
    await page.getByLabel(/^address$/i).fill("1 Test Street");
    await page.getByLabel(/^city$/i).fill("Reno");
    await page.getByLabel(/postcode/i).fill("89501");
    await page.locator("#checkout-ship-country").selectOption("US");
    await page.getByLabel(/state \/ province/i).fill("NV");
    let interrupted = false;
    await page.route(`**/orders/${orderId}/checkout`, async (route) => {
      if (!interrupted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        interrupted = true;
        const response = await route.fetch();
        // Next 16.3 answers a fetch-action redirect 200 + x-action-redirect (16.2 sent 303).
        expect([200, 303]).toContain(response.status());
        expect(response.headers()["x-action-redirect"]).toContain(`/orders/${orderId}`);
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: /continue to payment/i }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("We couldn't confirm checkout");
    await expect(page.getByLabel(/^address$/i)).toHaveValue("1 Test Street");
    await page.getByRole("button", { name: /continue to payment/i }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));
    const orders = await admin.from("orders").select("id,status,ship_line1,accepted_checkout_shipping,total_cents").eq("origin_offer_id", offer.data.id);
    if (orders.error) throw orders.error;
    expect(orders.data).toHaveLength(1);
    expect(orders.data[0]).toMatchObject({ id: orderId, status: "paid", ship_line1: "1 Test Street", total_cents: 9500 });
    expect(orders.data[0].accepted_checkout_shipping).toBeTruthy();
    const payments = await admin.from("payments").select("id,status").eq("order_id", orderId);
    if (payments.error) throw payments.error;
    expect(payments.data).toHaveLength(1);
    expect(payments.data[0].status).toBe("succeeded");
    await page.goto(`/orders/${orderId}/checkout`);
    await expect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));
  } finally {
    for (const id of users.reverse()) await cleanupFixtureUser(id);
  }
});
