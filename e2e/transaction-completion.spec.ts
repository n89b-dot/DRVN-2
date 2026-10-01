import { createHmac } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { fixtureAdmin } from "./fixtures";
import { cleanupE2eUsers, enableSellerPayouts, makeUser, publishListing, signUp } from "./helpers";

/**
 * Transaction-completion golden paths (brief §44), against the stub payment
 * AND stub shipping providers:
 *
 *   Flow A — DRVN Shipping: verified ship-from → live rates at checkout →
 *            label purchase → signed webhook delivery.
 *   Flow C — Local pickup: ready → Pickup Pass (code) → seller redeems →
 *            delivered.
 *   Flow D — Partial refund: dispute → seller offers an amount → buyer
 *            accepts → dispute settles, buyer keeps the item.
 *   Flow E — Return for refund: dispute → seller asks for the item back →
 *            prepaid return label → tracked back → received → refund.
 *
 * Server requirements (see e2e/README.md): PAYMENTS_MODE=stub,
 * SHIPPING_MODE=stub, FLAG_INTEGRATED_SHIPPING_V1=true and
 * EASYPOST_WEBHOOK_SECRET=e2e-webhook-secret (the webhook test signs with
 * it). Flow B (manual shipping) lives in golden-path.spec.ts.
 */

const stamp = Date.now();
const WEBHOOK_SECRET = process.env.EASYPOST_WEBHOOK_SECRET ?? "e2e-webhook-secret";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

async function fillCheckoutAddress(page: Page) {
  await page.getByLabel(/^name$/i).fill("E2E Buyer");
  await page.getByLabel(/^address$/i).fill("1 Test Street");
  await page.getByLabel(/^city$/i).fill("Reno");
  await page.getByLabel(/postcode/i).fill("89501");
  // The country SUBMITS via a state-bound hidden input; the visible select
  // is addressed by id (it deliberately carries no name — see checkout-steps).
  await page.locator("#checkout-ship-country").selectOption("US");
  await page.getByLabel(/state \/ province/i).fill("NV");
}

/** Buys the listing at `listingPath` and returns the order path. Assumes the
 *  stub payment provider settles inline (redirects straight to the order). */
async function buyListing(
  page: Page,
  listingPath: string,
  opts: { collection?: boolean; pickRate?: boolean } = {}
): Promise<string> {
  await page.goto(listingPath);
  // Wait for the in-place confirmation — navigating before the server action
  // lands loses the cart cookie (same rationale as golden-path.spec.ts).
  await page.getByRole("button", { name: /add to cart/i }).first().click();
  // No toast since 3daf293: the button turns into the cart link.
  await expect(page.getByRole("link", { name: /in cart.*view cart/i })).toBeVisible();
  await page.goto("/cart");
  await page.getByRole("link", { name: /proceed to checkout/i }).click();
  await expect(page).toHaveURL(/\/checkout/);
  if (opts.collection) {
    await page.getByLabel(/collecting in person/i).check();
    await page.getByLabel(/^name$/i).fill("E2E Buyer");
  } else {
    await fillCheckoutAddress(page);
  }
  if (opts.pickRate) {
    await page.getByRole("button", { name: /get shipping rates/i }).click();
    // Stub rates render as radios; the cheapest is pre-selected.
    await expect(page.getByText(/StubCarrier Ground/i)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /continue to payment/i }).click();
  } else {
    await page.getByRole("button", { name: /continue to payment/i }).click();
  }
  await expect(page).toHaveURL(/\/orders\/[\w-]+/, { timeout: 30_000 });
  return new URL(page.url()).pathname;
}

const sellerA = makeUser("txa-seller", stamp);
const buyerA = makeUser("txa-buyer", stamp);

/** Dispatch once, verify complete persistence, then require the action to
 * update its own UI without another click or a manual page reload. */
async function dispatchOrder(page: Page, tracking: string) {
  const orderId = new URL(page.url()).pathname.split("/").filter(Boolean).at(-1);
  expect(orderId, "order id in dispatch URL").toBeTruthy();

  await page.getByRole("button", { name: /mark dispatched/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/carrier/i).fill("USPS");
  await dialog.getByLabel(/tracking/i).fill(tracking);
  await dialog.getByRole("button", { name: /mark dispatched/i }).click();

  const admin = fixtureAdmin();
  await expect
    .poll(
      async () => {
        const [order, shipment] = await Promise.all([
          admin
            .from("orders")
            .select("status, carrier, tracking_number")
            .eq("id", orderId!)
            .maybeSingle(),
          admin
            .from("shipments")
            .select(
              "direction, fulfillment_type, provider, provider_tracker_id, tracking_code, carrier, status"
            )
            .eq("order_id", orderId!)
            .eq("direction", "outbound")
            .eq("tracking_code", tracking)
            .maybeSingle(),
        ]);
        if (order.error) throw order.error;
        if (shipment.error) throw shipment.error;
        return { order: order.data, shipment: shipment.data };
      },
      { message: "dispatch persisted completely", timeout: 30_000 }
    )
    .toEqual({
      order: { status: "shipped", carrier: "USPS", tracking_number: tracking },
      shipment: {
        direction: "outbound",
        fulfillment_type: "seller_arranged",
        provider: "stub",
        provider_tracker_id: `stubtrk_${tracking}`,
        tracking_code: tracking,
        carrier: "USPS",
        status: "in_transit",
      },
    });

  await expect(page.getByText(tracking).first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Click-until-true: server actions swap tiles via RSC refresh, unmounting
 * their own success messages, and a click can land before hydration — so
 * the only honest signal is page content. Clicks `button` (when present)
 * until `done` finds its target, reloading periodically.
 */
async function clickUntil(page: Page, button: RegExp, done: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 24; attempt++) {
    if (await done().catch(() => false)) return;
    const trigger = page.getByRole("button", { name: button }).first();
    if (await trigger.isVisible().catch(() => false)) {
      await trigger.click().catch(() => {});
    }
    await page.waitForTimeout(1_000);
    if (attempt % 6 === 5) await page.reload();
  }
  expect(await done().catch(() => false), `condition after clicking ${button}`).toBe(true);
}

/** Open a dispute from the buyer's order sheet. */
async function openDisputeAs(page: Page, orderPath: string, category: string) {
  await page.goto(orderPath);
  await page.getByRole("button", { name: /report a problem/i }).click();
  await page.locator('select[name="category"]').selectOption(category);
  await page.getByRole("button", { name: /open dispute/i }).click();
  await expect(page.getByText(/in dispute|with drvn support/i).first()).toBeVisible({
    timeout: 15_000,
  });
}

test.afterAll(async () => {
  await cleanupE2eUsers();
});

test("Flow C — local pickup: ready → pass → redeem → delivered", async ({ browser }) => {
  const sellerCtx = await browser.newContext();
  const buyerCtx = await browser.newContext();
  const seller = await sellerCtx.newPage();
  const buyer = await buyerCtx.newPage();

  const s = makeUser("txc-seller", stamp);
  const b = makeUser("txc-buyer", stamp);
  await signUp(seller, s);
  await enableSellerPayouts(s.username);
  await signUp(buyer, b);

  const listingPath = await publishListing(seller, {
    title: `E2E Pickup Part ${stamp}`,
    price: "120",
    shipping: "0",
    pickup: true,
  });
  const orderPath = await buyListing(buyer, listingPath, { collection: true });

  // Seller marks it ready; the tile swaps into the redeem form.
  await seller.goto(orderPath);
  await clickUntil(seller, /mark ready for pickup/i, () =>
    seller.getByLabel(/six-digit code/i).isVisible()
  );

  // Buyer opens the pass and reads the six-digit code.
  await buyer.goto(orderPath);
  const codeEl = buyer.locator("p.font-mono");
  await clickUntil(buyer, /show pickup pass/i, () => codeEl.isVisible());
  const code = ((await codeEl.textContent()) ?? "").replace(/\D/g, "");
  expect(code).toHaveLength(6);

  // Seller redeems it at handoff. Success = the order leaves 'paid': the
  // pickup tile disappears and the sheet reads delivered.
  await seller.goto(orderPath);
  await seller.getByLabel(/six-digit code/i).fill(code);
  await clickUntil(seller, /confirm handoff/i, async () => {
    return (
      !(await seller.getByLabel(/six-digit code/i).isVisible().catch(() => false)) &&
      (await seller.getByText(/delivered/i).first().isVisible())
    );
  });

  // The order entered the delivered/clearing path for the buyer too.
  await buyer.goto(orderPath);
  await expect(buyer.getByText(/delivered/i).first()).toBeVisible();

  await sellerCtx.close();
  await buyerCtx.close();
});

test("Flow A — DRVN Shipping: rates → label → webhook delivery", async ({ browser }) => {
  const sellerCtx = await browser.newContext();
  const buyerCtx = await browser.newContext();
  const seller = await sellerCtx.newPage();
  const buyer = await buyerCtx.newPage();

  await signUp(seller, sellerA);
  await enableSellerPayouts(sellerA.username);
  await signUp(buyer, buyerA);

  // Seller ship-from profile (stub provider verifies instantly).
  await seller.goto("/settings#shipping");
  await seller.getByLabel(/^name$/i).fill("E2E Seller");
  await seller.getByLabel(/street address/i).fill("2 Seller Way");
  await seller.getByLabel(/^city$/i).fill("Boise");
  await seller.getByLabel(/postal code/i).fill("83702");
  await seller.locator('select[name="country"]').selectOption("US");
  await seller.getByRole("button", { name: /save shipping details/i }).click();
  await expect(seller.getByText(/saved and verified/i)).toBeVisible({ timeout: 15_000 });

  const listingPath = await publishListing(seller, {
    title: `E2E Rated Part ${stamp}`,
    price: "300",
    drvn: true,
  });

  const orderPath = await buyListing(buyer, listingPath, { pickRate: true });
  // The frozen quote is on the order: stub Ground for 32oz = $11.20.
  await expect(buyer.getByText(/\$11\.20/).first()).toBeVisible();

  // Seller buys the label; success = the sheet shows the purchased-label
  // panel (the buy panel unmounts on the RSC refresh).
  await seller.goto(orderPath);
  await clickUntil(seller, /buy shipping label/i, () =>
    seller.getByText(/print the label/i).first().isVisible()
  );

  // Tracking code appears on the sheet; drive delivery through the SIGNED
  // webhook — the same door EasyPost uses. Read the code from its own
  // paragraph — body textContent concatenates nodes and corrupts the token.
  await seller.reload();
  const trackingEl = seller
    .locator("p")
    .filter({ hasText: /^STUB[A-Z0-9_]+$/ })
    .first();
  await expect(trackingEl).toBeVisible();
  const tracking = ((await trackingEl.textContent()) ?? "").trim();
  expect(tracking, "tracking code visible on the order sheet").toMatch(/^STUB[A-Z0-9_]+$/);

  // This callback is intentionally shaped like EasyPost even though the
  // browser suite bought its label through the stub provider. Make the
  // synthetic shipment identity internally consistent before exercising the
  // real webhook attribution checks.
  const trackerRef = `trk_e2e_${stamp}`;
  const providerShipmentRef = `shp_e2e_${stamp}`;
  const admin = fixtureAdmin();
  const { data: syntheticShipment, error: syntheticShipmentError } = await admin
    .from("shipments")
    .update({
      provider: "easypost",
      provider_shipment_id: providerShipmentRef,
      provider_tracker_id: trackerRef,
      tracking_code: tracking,
      carrier: "StubCarrier",
    })
    .eq("direction", "outbound")
    .eq("tracking_code", tracking)
    .select("provider, provider_shipment_id, provider_tracker_id, tracking_code, carrier")
    .single();
  expect(syntheticShipmentError).toBeNull();
  expect(syntheticShipment).toEqual({
    provider: "easypost",
    provider_shipment_id: providerShipmentRef,
    provider_tracker_id: trackerRef,
    tracking_code: tracking,
    carrier: "StubCarrier",
  });

  const payload = JSON.stringify({
    id: `evt_e2e_${stamp}`,
    description: "tracker.updated",
    result: {
      id: trackerRef,
      tracking_code: tracking,
      carrier: "StubCarrier",
      status: "delivered",
      tracking_details: [
        {
          status: "delivered",
          message: "Delivered (e2e webhook)",
          datetime: new Date().toISOString(),
          tracking_location: { city: "Reno", state: "NV", country: "US" },
        },
      ],
    },
  });
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(payload, "utf8").digest("hex");
  const response = await buyer.request.post("/api/shipping/easypost", {
    data: payload,
    headers: {
      "content-type": "application/json",
      "x-hmac-signature": `hmac-sha256-hex=${signature}`,
    },
  });
  expect(response.status()).toBe(200);

  await buyer.goto(orderPath);
  await expect(buyer.getByText(/delivered/i).first()).toBeVisible();

  await sellerCtx.close();
  await buyerCtx.close();
});

test("Flow D — partial refund: buyer keeps the item, dispute settles", async ({ browser }) => {
  const sellerCtx = await browser.newContext();
  const buyerCtx = await browser.newContext();
  const seller = await sellerCtx.newPage();
  const buyer = await buyerCtx.newPage();

  const s = makeUser("txd-seller", stamp);
  const b = makeUser("txd-buyer", stamp);
  await signUp(seller, s);
  await enableSellerPayouts(s.username);
  await signUp(buyer, b);

  const listingPath = await publishListing(seller, {
    title: `E2E Partial Part ${stamp}`,
    price: "200",
    shipping: "10",
  });
  const orderPath = await buyListing(buyer, listingPath);

  // Seller dispatches manually.
  await seller.goto(orderPath);
  await dispatchOrder(seller, `E2ED${stamp}`);

  // Buyer reports a problem.
  await openDisputeAs(buyer, orderPath, "item_not_as_described");

  // Seller offers a PARTIAL refund; the buyer keeps the part. Success = the
  // sheet shows the outstanding offer (the form unmounts on RSC refresh).
  await seller.goto(orderPath);
  await seller.getByLabel(/refund amount/i).fill("50");
  await clickUntil(seller, /offer this refund/i, () =>
    seller.getByText(/waiting on the buyer|offered a refund of \$50/i).first().isVisible()
  );

  // Buyer accepts; success = the payment line records the partial refund and
  // the order is restored to shipped rather than closed as refunded.
  await buyer.goto(orderPath);
  await clickUntil(buyer, /accept \$50 refund/i, () =>
    buyer.getByText(/\$50 refunded/i).first().isVisible()
  );
  await expect(buyer.getByText(/shipped|in transit/i).first()).toBeVisible();

  await sellerCtx.close();
  await buyerCtx.close();
});

test("Flow E — return for refund: item travels back before money", async ({ browser }) => {
  const sellerCtx = await browser.newContext();
  const buyerCtx = await browser.newContext();
  const seller = await sellerCtx.newPage();
  const buyer = await buyerCtx.newPage();

  const s = makeUser("txe-seller", stamp);
  const b = makeUser("txe-buyer", stamp);
  await signUp(seller, s);
  await enableSellerPayouts(s.username);
  // Return labels rate from the seller's ship-from profile.
  await seller.goto("/settings#shipping");
  await seller.getByLabel(/^name$/i).fill("E2E Seller E");
  await seller.getByLabel(/street address/i).fill("3 Seller Way");
  await seller.getByLabel(/^city$/i).fill("Boise");
  await seller.getByLabel(/postal code/i).fill("83702");
  await seller.locator('select[name="country"]').selectOption("US");
  await seller.getByRole("button", { name: /save shipping details/i }).click();
  await expect(seller.getByText(/saved and verified/i)).toBeVisible({ timeout: 15_000 });
  await signUp(buyer, b);

  const listingPath = await publishListing(seller, {
    title: `E2E Return Part ${stamp}`,
    price: "150",
    shipping: "15",
  });
  const orderPath = await buyListing(buyer, listingPath);

  await seller.goto(orderPath);
  await dispatchOrder(seller, `E2EE${stamp}`);

  await openDisputeAs(buyer, orderPath, "wrong_item");

  // Seller: send it back, then I refund. Success = the Return tile appears
  // awaiting the buyer's shipment.
  await seller.goto(orderPath);
  await clickUntil(seller, /ask for the item back/i, () =>
    seller.getByText(/awaiting shipment/i).first().isVisible()
  );

  // Buyer: prepaid label (stub, seller-responsible) — the return shipment
  // lands on the Tracking tile as a purchased label.
  await buyer.goto(orderPath);
  await clickUntil(buyer, /get a prepaid return label/i, () =>
    buyer.getByText(/label purchased/i).first().isVisible()
  );
  // Mark it shipped; success = the buyer's shipping panel unmounts (the RMA
  // is in transit and no longer theirs to act on).
  await clickUntil(buyer, /i've shipped it|add tracking — it's shipped/i, async () => {
    const panelGone = !(await buyer
      .getByRole("button", { name: /i've shipped it|add tracking/i })
      .first()
      .isVisible()
      .catch(() => false));
    return panelGone && (await buyer.getByText(/in transit/i).first().isVisible());
  });

  // Seller: it's back — the agreed refund (item + original shipping = the
  // whole payment) executes now, closing the order as refunded.
  await seller.goto(orderPath);
  await clickUntil(seller, /back and as expected — refund the buyer/i, () =>
    seller.getByText(/refunded/i).first().isVisible()
  );

  await buyer.goto(orderPath);
  await expect(buyer.getByText(/refunded/i).first()).toBeVisible({ timeout: 15_000 });

  await sellerCtx.close();
  await buyerCtx.close();
});
