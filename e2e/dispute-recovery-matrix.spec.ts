import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

test("dispute open, escalation and settlement recover from local request failures", async ({ page }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Dispute recovery fixtures are restricted to the isolated local stack");
  test.setTimeout(120_000);
  const admin = fixtureAdmin();
  const users: string[] = [];
  const password = `Dispute-matrix-${randomUUID()}!`;
  const buyerEmail = `e2e-dispute-matrix-${randomUUID()}@drvn.test`;
  try {
    for (const email of [buyerEmail, `e2e-dispute-matrix-seller-${randomUUID()}@drvn.test`]) {
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw created.error ?? new Error("Missing dispute user");
      users.push(created.data.user.id);
      await admin.from("profiles").update({ username: `dispmatrix${randomUUID().replaceAll("-", "").slice(0, 15)}` }).eq("id", created.data.user.id).throwOnError();
    }
    async function orderFixture(status: "shipped" | "disputed", extra: Record<string, unknown> = {}) {
      const listing = await admin.from("listings").insert({ seller_id: users[1], title: `Dispute matrix ${randomUUID()}`, category: "performance", price_cents: 10000, shipping_cents: 0, currency: "USD", status: "sold" }).select("id").single().throwOnError();
      const order = await admin.from("orders").insert({ buyer_id: users[0], seller_id: users[1], status, pre_dispute_status: status === "disputed" ? "shipped" : null, subtotal_cents: 10000, shipping_cents: 0, platform_fee_cents: 1000, total_cents: 10000, currency: "USD", ...extra }).select("id").single().throwOnError();
      await admin.from("order_items").insert({ order_id: order.data.id, listing_id: listing.data.id, title: "Dispute matrix item", price_cents: 10000, shipping_cents: 0 }).throwOnError();
      return order.data.id;
    }
    const openOrder = await orderFixture("shipped", { shipped_at: new Date().toISOString() });
    // Past the seller's 3 business days whatever weekday the run lands on
    // (20261107210300), and well inside the 21-business-day window.
    const escalateOrder = await orderFixture("disputed", { dispute_category: "wrong_item", disputed_at: new Date(Date.now() - 8 * 86_400_000).toISOString() });
    const settleOrder = await orderFixture("disputed", { dispute_category: "wrong_item", disputed_at: new Date().toISOString(), refund_offer_cents: 2500, refund_offered_at: new Date().toISOString() });
    await admin.from("payments").insert({ order_id: settleOrder, provider: "stub", provider_reference: `stub_${randomUUID()}`, status: "succeeded", amount_cents: 10000, currency: "USD" }).throwOnError();

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(buyerEmail);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);

    await page.goto(`/orders/${openOrder}`);
    await page.getByRole("button", { name: /report a problem/i }).click();
    const category = page.locator('select[name="category"]');
    const reason = page.locator('textarea[name="reason"]');
    await category.selectOption("wrong_item");
    await reason.fill("The received item is different from the listing");
    await page.route(`**/api/orders/${openOrder}/dispute`, route => route.abort("failed"), { times: 1 });
    await page.getByRole("button", { name: /open dispute/i }).click();
    await expect(page.getByRole("main").getByRole("alert").filter({ hasText: "could not be confirmed" })).toBeVisible();
    await expect(category).toHaveValue("wrong_item");
    await expect(reason).toHaveValue("The received item is different from the listing");
    await page.getByRole("button", { name: /open dispute/i }).click();
    await expect.poll(async () => (await admin.from("orders").select("status").eq("id", openOrder).single()).data?.status).toBe("disputed");
    await expect(page.getByText("The received item is different from the listing")).toBeVisible();

    await page.goto(`/orders/${escalateOrder}`);
    await page.route(`**/orders/${escalateOrder}`, route => route.abort("failed"), { times: 1 });
    const escalate = page.getByRole("button", { name: /ask drvn to step in/i });
    await escalate.click();
    await expect(escalate.locator("xpath=ancestor::form").getByRole("alert").filter({ hasText: "Your details are still here" })).toBeVisible();
    await escalate.click();
    await expect(page.getByText("With DRVN support", { exact: true })).toBeVisible();
    await expect.poll(async () => (await admin.from("orders").select("dispute_escalated_at").eq("id", escalateOrder).single()).data?.dispute_escalated_at).toBeTruthy();

    await page.goto(`/orders/${settleOrder}`);
    await page.route(`**/orders/${settleOrder}`, route => route.abort("failed"), { times: 1 });
    const accept = page.getByRole("button", { name: /accept \$25 refund/i });
    await accept.click();
    await expect(accept.locator("xpath=ancestor::form").getByRole("alert").filter({ hasText: "Your details are still here" })).toBeVisible();
    await accept.click();
    await expect(page.getByText(/\$25 refunded/)).toBeVisible();
    await expect.poll(async () => (await admin.from("payments").select("refunded_cents").eq("order_id", settleOrder).single()).data?.refunded_cents).toBe(2500);
  } finally {
    for (const id of users.reverse()) await cleanupFixtureUser(id);
  }
});
