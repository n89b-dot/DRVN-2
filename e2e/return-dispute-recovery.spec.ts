import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

test("dispute and return controls stay retryable after failed Server Action requests", async ({ page, browser }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Transaction recovery fixtures are restricted to the isolated local stack");
  test.setTimeout(120_000);
  const admin = fixtureAdmin();
  const users: string[] = [];
  const password = `Return-dispute-${randomUUID()}!`;
  const sellerEmail = `e2e-return-dispute-${randomUUID()}@drvn.test`;
  page.setDefaultTimeout(15_000);
  try {
    for (const email of [sellerEmail, `e2e-return-dispute-buyer-${randomUUID()}@drvn.test`]) {
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw created.error ?? new Error("Missing transaction user");
      users.push(created.data.user.id);
      const named = await admin.from("profiles").update({ username: `retretry${randomUUID().replaceAll("-", "").slice(0, 16)}` }).eq("id", created.data.user.id);
      if (named.error) throw named.error;
    }
    await admin.from("profiles").update({ profile_type: "shop" }).eq("id", users[0]).throwOnError();
    await admin.from("shop_profiles").insert({ profile_id: users[0], returns_accepted: true, return_window_days: 30 }).throwOnError();
    const listings = await admin.from("listings").insert([
      { seller_id: users[0], title: "Return retry fixture", category: "performance", price_cents: 7000, shipping_cents: 0, currency: "USD", status: "sold" },
      { seller_id: users[0], title: "Return retry second item", category: "performance", price_cents: 3000, shipping_cents: 0, currency: "USD", status: "sold" },
    ]).select("id");
    if (listings.error) throw listings.error;
    const disputeOrder = await admin.from("orders").insert({ buyer_id: users[1], seller_id: users[0], status: "disputed", pre_dispute_status: "delivered", dispute_category: "wrong_item", dispute_reason: "Fixture dispute", disputed_at: new Date().toISOString(), subtotal_cents: 10000, shipping_cents: 0, platform_fee_cents: 1000, total_cents: 10000, currency: "USD" }).select("id").single();
    if (disputeOrder.error) throw disputeOrder.error;
    const order = await admin.from("orders").insert({ buyer_id: users[1], seller_id: users[0], status: "disputed", pre_dispute_status: "delivered", dispute_category: "wrong_item", dispute_reason: "Return fixture dispute", disputed_at: new Date().toISOString(), delivered_at: new Date().toISOString(), subtotal_cents: 10000, shipping_cents: 0, platform_fee_cents: 1000, total_cents: 10000, currency: "USD" }).select("id").single();
    if (order.error) throw order.error;
    const cancelOrder = await admin.from("orders").insert({ buyer_id: users[1], seller_id: users[0], status: "delivered", delivered_at: new Date().toISOString(), subtotal_cents: 3000, shipping_cents: 0, platform_fee_cents: 300, total_cents: 3000, currency: "USD" }).select("id").single();
    if (cancelOrder.error) throw cancelOrder.error;
    const approveOrder = await admin.from("orders").insert({ buyer_id: users[1], seller_id: users[0], status: "delivered", delivered_at: new Date().toISOString(), subtotal_cents: 3000, shipping_cents: 0, platform_fee_cents: 300, total_cents: 3000, currency: "USD" }).select("id").single();
    if (approveOrder.error) throw approveOrder.error;
    const items = await admin.from("order_items").insert([
      { order_id: order.data.id, listing_id: listings.data[0].id, title: "Return retry fixture", price_cents: 7000, shipping_cents: 0 },
      { order_id: order.data.id, listing_id: listings.data[1].id, title: "Return retry second item", price_cents: 3000, shipping_cents: 0 },
      { order_id: cancelOrder.data.id, listing_id: listings.data[1].id, title: "Return retry second item", price_cents: 3000, shipping_cents: 0 },
      { order_id: approveOrder.data.id, listing_id: listings.data[1].id, title: "Return retry second item", price_cents: 3000, shipping_cents: 0 },
    ]).select("id,order_id");
    if (items.error) throw items.error;
    await admin.from("payments").insert({ order_id: order.data.id, provider: "stub", provider_reference: `stub_${order.data.id}`, status: "succeeded", amount_cents: 10000, currency: "USD", idempotency_key: `return-recovery:${order.data.id}` }).throwOnError();

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(sellerEmail);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    await page.goto(`/orders/${disputeOrder.data.id}`);

    const failNextAction = async (target = page) => {
      await target.route("**/orders/**", async route => {
        if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
          await route.abort("failed");
        } else await route.continue();
      }, { times: 1 });
    };

    const amount = page.getByLabel("Refund amount");
    await amount.fill("25.00");
    await failNextAction();
    await page.getByRole("button", { name: /offer this refund/i }).click();
    await expect(amount.locator("xpath=ancestor::form").getByRole("alert").filter({ hasText: "Your details are still here" })).toBeVisible();
    await expect(amount).toHaveValue("25.00");
    await page.getByRole("button", { name: /offer this refund/i }).click();
    await expect(page.getByText(/You offered a refund of \$25/)).toBeVisible();
    await expect.poll(async () => (await admin.from("orders").select("refund_offer_cents").eq("id", disputeOrder.data.id).single()).data?.refund_offer_cents).toBe(2500);

    await page.goto(`/orders/${order.data.id}`);

    const excludedItem = page.getByRole("checkbox", { name: /Return retry second item/i });
    await excludedItem.uncheck();
    await failNextAction();
    const propose = page.getByRole("button", { name: /ask for the item back/i });
    await propose.click();
    await expect(propose.locator("xpath=ancestor::form").getByRole("alert").filter({ hasText: "Your details are still here" })).toBeVisible();
    await expect(excludedItem).not.toBeChecked();
    await propose.click();
    // Once a return is running the proposal form is replaced by the return's
    // own panel (orders/[id]/page.tsx hides it), so its confirmation goes too.
    await expect(page.getByText("awaiting shipment", { exact: true })).toBeVisible();
    const returns = await admin.from("returns").select("id,status").eq("order_id", order.data.id);
    if (returns.error) throw returns.error;
    expect(returns.data).toHaveLength(1);
    expect(returns.data[0].status).toBe("awaiting_shipment");

    const buyerContext = await browser.newContext();
    const buyer = await buyerContext.newPage();
    buyer.setDefaultTimeout(15_000);
    const buyerEmail = (await admin.auth.admin.getUserById(users[1])).data.user?.email;
    if (!buyerEmail) throw new Error("Missing buyer email");
    await buyer.goto("/login");
    await buyer.getByLabel(/^email$/i).fill(buyerEmail);
    await buyer.getByLabel(/^password$/i).fill(password);
    await buyer.getByRole("button", { name: /log in|sign in/i }).click();
    await buyer.waitForURL(/\/home/);
    await buyer.goto(`/orders/${order.data.id}`);
    const carrier = buyer.getByLabel(/^carrier$/i);
    const tracking = buyer.getByLabel(/tracking number/i);
    await carrier.fill("USPS recovery");
    await tracking.fill("RETURN-RECOVERY-123");
    await failNextAction(buyer);
    await buyer.getByRole("button", { name: /add tracking/i }).click();
    await expect(carrier.locator("xpath=ancestor::form").getByRole("alert").filter({ hasText: "Your details are still here" })).toBeVisible();
    await expect(carrier).toHaveValue("USPS recovery");
    await expect(tracking).toHaveValue("RETURN-RECOVERY-123");
    await buyer.getByRole("button", { name: /add tracking/i }).click();
    await expect.poll(async () => (await admin.from("returns").select("status").eq("id", returns.data[0].id).single()).data?.status).toBe("in_transit");

    await page.reload();
    await failNextAction();
    const receive = page.getByRole("button", { name: /back and as expected/i });
    await receive.click();
    await expect(receive.locator("xpath=ancestor::form").getByRole("alert").filter({ hasText: "Your details are still here" })).toBeVisible();
    await receive.click();
    await expect.poll(async () => (await admin.from("returns").select("status").eq("id", returns.data[0].id).single()).data?.status).toBe("completed");
    await expect.poll(async () => (await admin.from("payments").select("refunded_cents").eq("order_id", order.data.id).single()).data?.refunded_cents).toBe(7000);
    await expect.poll(async () => (await admin.from("refund_operations").select("status").eq("requested_by", `return:${returns.data[0].id}`).single()).data?.status).toBe("completed");

    const cancellable = await admin.rpc("create_shop_policy_return", { p_order: cancelOrder.data.id, p_buyer: users[1], p_reason: "Changed my mind" });
    const cancellableId = (cancellable.data as { return_id?: string } | null)?.return_id;
    if (cancellable.error || !cancellableId) throw cancellable.error ?? new Error("Missing cancellable return");
    await admin.rpc("respond_shop_policy_return", { p_return: cancellableId, p_seller: users[0], p_decision: "approve", p_ship_days: 7 }).throwOnError();
    await buyer.goto(`/orders/${cancelOrder.data.id}`);
    await failNextAction(buyer);
    const cancel = buyer.getByRole("button", { name: /withdraw the return/i });
    await cancel.click();
    await expect(cancel.locator("xpath=ancestor::form").getByRole("alert").filter({ hasText: "Your details are still here" })).toBeVisible();
    await cancel.click();
    await expect.poll(async () => (await admin.from("returns").select("status").eq("id", cancellableId).single()).data?.status).toBe("cancelled");

    const requested = await admin.rpc("create_shop_policy_return", { p_order: approveOrder.data.id, p_buyer: users[1], p_reason: "Policy return" });
    const requestedId = (requested.data as { return_id?: string } | null)?.return_id;
    if (requested.error || !requestedId) throw requested.error ?? new Error("Missing approval return");
    await page.goto(`/orders/${approveOrder.data.id}`);
    await failNextAction();
    const approve = page.getByRole("button", { name: /approve the return/i });
    await approve.click();
    await expect(approve.locator("xpath=ancestor::form").getByRole("alert").filter({ hasText: "Your details are still here" })).toBeVisible();
    await approve.click();
    await expect.poll(async () => (await admin.from("returns").select("status").eq("id", requestedId).single()).data?.status).toMatch(/approved|awaiting_shipment/);
    await buyerContext.close();
  } finally {
    for (const id of users.reverse()) await cleanupFixtureUser(id);
  }
});
