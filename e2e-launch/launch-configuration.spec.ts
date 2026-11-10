import { expect, test, type Page } from "@playwright/test";

import { cleanupE2eUsers, enableSellerPayouts, makeUser, publishListing, signIn, signUp } from "../e2e/helpers";

import { confirmWithTestCard, forwardPaymentEvent, intentStatus } from "./stripe-forward";

/**
 * The configuration DRVN launches with, in a browser (plan 2 item A4, review
 * finding #162, OS id R-unproven).
 *
 * The app under test was built and started from the recorded launch
 * configuration (docs/release-evidence/launch-configuration.json): Stripe in
 * test mode, the public data cache on, the agent off, DRVN Shipping off. The
 * main suite runs none of those. What this protects:
 *
 *   - a signed-out visitor's second read is answered from the shared copy,
 *     not the database (the cache is really on);
 *   - a seller's edit shows to visitors at once (a write really clears it);
 *   - a guest can pay with a card through Stripe's own form, and the order is
 *     settled by the webhook;
 *   - with DRVN Shipping off, a completed sale leaves nothing in the label,
 *     label-refund or cost-carrying tables.
 */

const stamp = Date.now();
const seller = makeUser("launch-seller", stamp);
const guestEmail = `e2e-launch-guest-${stamp}@drvn.test`;
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

const firstTitle = `E2E Launch Manifold ${stamp}`;
const databaseTitle = `E2E Launch Changed Underneath ${stamp}`;
const editedTitle = `E2E Launch Edited By Seller ${stamp}`;
const saleTitle = `E2E Launch Turbo ${stamp}`;

const AGENT_STEPS = ["seller", "buyer", "chat", "jobs"];

let cachedListingPath = "";
let saleListingPath = "";

async function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("the launch lane needs a Supabase service key for its fixtures");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

const listingId = (path: string) => path.split("/").pop()!;

/**
 * Stripe's own payment form has mounted and offers card payment. This proves
 * the publishable key, Stripe.js and the client secret the server minted all
 * work together in this configuration. The form is not typed into: Stripe
 * varies what it shows from visit to visit (Link, bank and Klarna options
 * appear and disappear) and asks integrators not to automate it, so the card
 * is presented through Stripe's API instead (confirmWithTestCard).
 */
async function expectStripeFormMounted(page: Page) {
  const frame = page.frameLocator('iframe[title="Secure payment input frame"]').first();
  const cardFields = frame.locator('input[name="number"]');
  const cardChoice = frame.getByText("Card", { exact: true }).first();
  await expect(cardFields.or(cardChoice).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /pay \$/i })).toBeEnabled();
}

test.describe.serial("launch configuration (R-unproven)", () => {
  test.afterAll(async () => {
    const admin = await serviceClient();
    await admin.from("agent_beta_steps").update({ open: false }).in("step", AGENT_STEPS);
    await cleanupE2eUsers();
  });

  test("the seller's side shows no DRVN Shipping and no agent (R-unproven)", async ({ page }) => {
    await signUp(page, seller);
    await enableSellerPayouts(seller.username);

    await page.goto("/sell");
    const modes = await page.getByLabel(/how it ships/i).locator("option").allTextContents();
    expect(modes, "DRVN Shipping is off at launch, so the sell form must not offer it").toEqual(["Flat rate", "Local pickup only"]);

    // The agent is off because the environment switch is absent, whatever the
    // admin console says. Open every beta step in the database, as an admin
    // could, and the agent must still be nowhere a member can see. (With the
    // steps closed this check would pass even with the switch on.)
    const admin = await serviceClient();
    const opened = await admin.from("agent_beta_steps").update({ open: true }).in("step", AGENT_STEPS).select("step");
    expect(opened.error, "the fixture could not open the agent beta steps").toBeNull();
    expect(opened.data, "all four beta steps exist and are now open").toHaveLength(AGENT_STEPS.length);
    await page.goto("/home");
    await expect(page.getByRole("link", { name: /^agent$/i })).toHaveCount(0);
    // Its address answers with the app's "not here" page, not the agent.
    await page.goto("/agent");
    await expect(page.getByRole("heading", { name: /not yours to see/i })).toBeVisible();

    cachedListingPath = await publishListing(page, { title: firstTitle, price: "140", shipping: "12" });
    saleListingPath = await publishListing(page, { title: saleTitle, price: "310", shipping: "15" });
  });

  test("a signed-out visitor's second read comes from the shared copy (R-unproven)", async ({ browser }) => {
    const visitor = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
    await visitor.goto(cachedListingPath);
    await expect(visitor.getByRole("heading", { name: firstTitle }).first()).toBeVisible();

    // Change the row underneath the app, the way no member can: no action
    // runs, so nothing clears the shared copy.
    const admin = await serviceClient();
    const { error } = await admin.from("listings").update({ title: databaseTitle }).eq("id", listingId(cachedListingPath));
    expect(error, "the fixture could not change the listing directly").toBeNull();
    const { data: row } = await admin.from("listings").select("title").eq("id", listingId(cachedListingPath)).single();
    expect(row?.title, "the database really holds the new title").toBe(databaseTitle);

    // The database has the new title; a visitor is still shown the old one,
    // which can only have come from the copy. With the cache off this fails.
    await visitor.reload();
    await expect(visitor.getByRole("heading", { name: firstTitle }).first()).toBeVisible();
    await expect(visitor.getByText(databaseTitle)).toHaveCount(0);
    await visitor.context().close();
  });

  test("a seller's edit shows to visitors at once (R-unproven)", async ({ page, browser }) => {
    await signIn(page, seller);
    await page.goto(`${cachedListingPath}/edit`);
    // The form opens on what the database holds, not on the shared copy.
    await expect(page.getByLabel("Title")).toHaveValue(databaseTitle);
    await page.getByLabel("Title").fill(editedTitle);
    await page.locator(".saverow").getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Listing updated.")).toBeVisible({ timeout: 30_000 });

    // No waiting for the copy to age out: the edit itself cleared it.
    const visitor = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
    await visitor.goto(cachedListingPath);
    await expect(visitor.getByRole("heading", { name: editedTitle }).first()).toBeVisible();
    await visitor.goto("/marketplace");
    await expect(visitor.getByText(editedTitle).first()).toBeVisible();
    await visitor.context().close();
  });

  test("a guest pays by card through Stripe and the webhook settles the order (R-unproven)", async ({ browser }) => {
    const guest = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
    await guest.goto(saleListingPath);
    await guest.getByRole("button", { name: /buy now/i }).first().click();
    await expect(guest).toHaveURL(/\/cart/);
    await guest.getByRole("link", { name: /proceed to checkout/i }).first().click();
    await expect(guest).toHaveURL(/\/checkout/);

    await guest.locator('input[name="email"]').fill(guestEmail);
    await guest.getByLabel(/18 or over/i).check();
    await guest.locator('input[name="ship_name"]').fill("Launch Guest");
    await guest.locator('input[name="ship_line1"]').fill("1 Test Street");
    await guest.locator('input[name="ship_city"]').fill("Reno");
    await guest.locator('input[name="ship_postcode"]').fill("89501");
    await guest.locator("#checkout-ship-country").selectOption("US");
    await guest.getByLabel(/state \/ province/i).fill("NV");
    await guest.getByRole("button", { name: /continue to payment/i }).first().click();

    // Stripe's own form, loaded with the publishable key. The stub never shows it.
    await expectStripeFormMounted(guest);

    const admin = await serviceClient();
    const { data: account } = await admin.from("account_emails").select("user_id").eq("email", guestEmail).maybeSingle();
    expect(account?.user_id, "guest checkout creates an account for the order").toBeTruthy();
    const { data: orders } = await admin.from("orders").select("id, status, total_cents").eq("buyer_id", account!.user_id);
    expect(orders, "exactly one order for the guest").toHaveLength(1);
    const order = orders![0];
    const { data: payment } = await admin.from("payments").select("provider_reference, amount_cents").eq("order_id", order.id).single();
    const intentId = payment!.provider_reference as string;
    expect(intentId, "the payment is a real Stripe intent, not the stub's").toMatch(/^pi_/);
    expect(await intentStatus(intentId), "the intent the app minted is for the order's total, in test mode").toMatchObject({ amount: order.total_cents, livemode: false });

    // Pay with Stripe's test Visa, then arrive where Stripe sends the buyer back to.
    const returnUrl = new URL("/cart/complete", baseURL);
    returnUrl.searchParams.set("orders", order.id);
    expect((await confirmWithTestCard(intentId, returnUrl.toString())).status).toBe("succeeded");
    returnUrl.searchParams.set("payment_intent", intentId);
    await guest.goto(returnUrl.toString());

    // Stripe has the money, but the app has not settled: it never trusts the browser's return.
    await expect(guest).toHaveURL(/\/order-placed\?processing=1/);
    await expect(guest.getByText(/payment is still settling/i)).toBeVisible();
    expect((await admin.from("orders").select("status").eq("id", order.id).single()).data?.status, "before the webhook the order is not paid").not.toBe("paid");

    const delivered = await forwardPaymentEvent({ intentId, type: "payment_intent.succeeded", baseURL });
    expect(delivered.status, `the webhook answered ${delivered.status}: ${delivered.body}`).toBe(200);
    await expect
      .poll(async () => (await admin.from("orders").select("status").eq("id", order.id).single()).data?.status, { timeout: 30_000 })
      .toBe("paid");
    // A second delivery of the same event changes nothing.
    const again = await forwardPaymentEvent({ intentId, type: "payment_intent.succeeded", baseURL });
    expect({ status: again.status, body: again.body }).toEqual({ status: 200, body: "duplicate" });

    // The receipt this browser was given now says so.
    await guest.goto("/order-placed");
    await expect(guest.getByText(/paid and confirmed/i).first()).toBeVisible();

    // The part is sold, and visitors see that at once: the webhook cleared the shared copy.
    const visitor = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
    await visitor.goto(saleListingPath);
    await expect(visitor.getByRole("button", { name: /buy now/i })).toHaveCount(0);
    await visitor.context().close();
    await guest.context().close();
  });

  test("with DRVN Shipping off, a completed sale leaves the label and carry tables empty (R-unproven)", async () => {
    const admin = await serviceClient();
    for (const table of ["shipping_rate_quotes", "seller_adjustments", "seller_carry_entries", "outbound_label_void_requests"]) {
      const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
      expect(error, `${table} could not be read`).toBeNull();
      expect(count, `${table} must be empty in the launch configuration`).toBe(0);
    }
    const { data: drvn } = await admin.from("listings").select("id").eq("shipping_mode", "drvn");
    expect(drvn ?? [], "no listing offers DRVN Shipping").toHaveLength(0);
  });
});
