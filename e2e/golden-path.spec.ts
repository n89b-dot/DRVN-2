import { expect, test } from "@playwright/test";

import { fixtureAdmin } from "./fixtures";
import { attachSellPhoto, enableSellerPayouts, sellCommitButton, signIn, signUp } from "./helpers";

/**
 * The golden path, end to end: a seller lists a part off a car they own, a buyer
 * buys it, the seller dispatches it, the buyer confirms receipt and reviews.
 *
 * This is the only test that exercises RLS, the purchase RPC and the fulfilment
 * state machine together. It runs against a real Supabase project — see
 * e2e/README.md.
 */

const stamp = Date.now();
const seller = {
  email: `e2e-seller-${stamp}@drvn.test`,
  password: "e2e-password-123",
  username: `e2eseller${stamp}`.slice(0, 24),
  displayName: "E2E Seller",
};
const buyer = {
  email: `e2e-buyer-${stamp}@drvn.test`,
  password: "e2e-password-123",
  username: `e2ebuyer${stamp}`.slice(0, 24),
  displayName: "E2E Buyer",
};

const carName = `E2E Test Car ${stamp}`;
const partTitle = `E2E Test Downpipe ${stamp}`;
const partPrice = "250";

test.describe.serial("golden path", () => {
  test("seller signs up and adds a car", async ({ page }) => {
    await signUp(page, seller);

    await page.goto("/garage");
    await page.getByRole("button", { name: /add a car|add car/i }).first().click();
    const addCarDialog = page.getByRole("dialog");
    // The picker is the primary flow (0041); tests name their cars, so take
    // the manual fallback — always visible at the dialog's foot.
    await addCarDialog.getByRole("button", { name: /enter it manually/i }).last().click();
    await addCarDialog.getByLabel(/^name/i).first().fill(carName);
    await addCarDialog.getByRole("button", { name: /add to garage/i }).click();

    // Lands on the car's edit page.
    await expect(page).toHaveURL(/\/garage\/[\w-]+\/edit/);
    await expect(page.getByText(carName).first()).toBeVisible();
  });

  test("seller lists a part off that car", async ({ page }) => {
    await signIn(page, seller);
    // Publishing is gated on payouts whenever the app runs against Stripe
    // (src/app/(product)/sell): a seller with nowhere to be paid cannot list.
    // Real accounts earn the flag through Connect onboarding, which can't be
    // automated (hCaptcha); test accounts get it set with the service role.
    await enableSellerPayouts(seller.username);
    await page.goto("/sell");

    await page.getByLabel(/title/i).fill(partTitle);
    await page.getByLabel(/^category/i).selectOption({ index: 1 });
    await page.getByLabel(/asking price/i).fill(partPrice);

    // Attach the car — this is the provenance link the product is built on.
    const sourceCar = page.locator('select[name="source_car_id"]');
    await sourceCar.selectOption({ label: `Off my sheet — ${carName}` });

    // A public listing leads with its photo; publishing needs one.
    await attachSellPhoto(page);
    await sellCommitButton(page).click();

    await expect(page).toHaveURL(/\/listings\/[\w-]+/);
    await expect(page.getByRole("heading", { name: partTitle })).toBeVisible();
  });

  test("the part appears on the car sheet's For sale tab", async ({ page }) => {
    await signIn(page, seller);
    await page.goto("/garage");
    // The Garage opens on the main car (3daf293); its build page is one link away.
    await page.getByRole("link", { name: /view the build page/i }).click();

    await page.getByRole("tab", { name: /for sale/i }).click();
    await expect(page.getByText(partTitle)).toBeVisible();

    // The tab is deep-linkable: that was the point of URL-backed state.
    await expect(page).toHaveURL(/[?&]view=forsale/);
  });

  test("buyer finds the part and buys it", async ({ page }) => {
    await signUp(page, buyer);

    await page.goto(`/marketplace?q=${encodeURIComponent(partTitle)}`);
    // The card, not the active-filter readout: the query echo renders above
    // the grid and carries the same text, so a bare getByText picks that and
    // clicking it goes nowhere.
    await page.locator(".mosaic a.marketplace-card__link", { hasText: partTitle }).first().click();
    await expect(page).toHaveURL(/\/listings\/[\w-]+/);

    // Add-to-cart stays on the listing (in-place confirmation, badge update);
    // going to the cart is the buyer's own step.
    await page.getByRole("button", { name: /add to cart/i }).click();
    // No toast since 3daf293: the button turns into the cart link.
    await expect(page.getByRole("link", { name: /in cart.*view cart/i })).toBeVisible();
    await page.getByRole("link", { name: /in cart.*view cart/i }).click();
    await page.getByRole("link", { name: /proceed to checkout/i }).click();
    await expect(page).toHaveURL(/\/checkout/);

    // Checkout collects a delivery address.
    await page.getByLabel(/^name/i).fill("E2E Buyer");
    await page.getByLabel(/^address$/i).fill("1 Test Street");
    await page.getByLabel(/city/i).fill("Testville");
    await page.getByLabel(/postcode/i).fill("TE5 7ST");
    // Country is a structured select storing ISO codes (0028).
    await page.getByLabel(/country/i).selectOption({ label: "United Kingdom" });
    // Stub mode settles inline: the address submit completes the purchase and
    // lands on the order. Against Stripe this step stops at the Payment
    // Element instead — see e2e/README.md, which is why the money-completing
    // specs are run with PAYMENTS_MODE=stub.
    let interruptedCheckout = false;
    await page.route("**/checkout", async (route) => {
      if (!interruptedCheckout && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        interruptedCheckout = true;
        const response = await route.fetch();
        // Next 16.3 answers a fetch-action redirect 200 + x-action-redirect (16.2 sent 303).
        expect([200, 303]).toContain(response.status());
        expect(response.headers()["x-action-redirect"]).toContain("/orders/");
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: /continue to payment|confirm and pay/i }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("We couldn't confirm checkout");
    await expect(page.getByLabel(/^address$/i)).toHaveValue("1 Test Street");
    await page.getByRole("button", { name: /continue to payment|confirm and pay/i }).click();

    await page.waitForURL(/\/orders/, { timeout: 60_000 });
    await expect(page.getByText(/order placed/i).first()).toBeVisible();
  });

  test("the listing is now sold, not buyable twice", async ({ page }) => {
    await signIn(page, buyer);
    await page.goto(`/marketplace?q=${encodeURIComponent(partTitle)}`);

    // Sold parts leave the active market — scoped to the results grid, since
    // shell chrome (e.g. recently-viewed/notification previews) may still
    // reference the title without it being buyable. The active-filter chip
    // also carries the search text in its accessible name, so "no listing
    // links" is asserted by destination, not by name.
    await expect(page.locator(".mosaic").getByText(partTitle)).toHaveCount(0);
    await expect(
      page.locator('a[href^="/listings/"]', { hasText: partTitle })
    ).toHaveCount(0);
  });

  test("seller dispatches with tracking", async ({ page }) => {
    await signIn(page, seller);
    // Orders is tabbed now — sales live on their own view.
    await page.goto("/orders?view=sales");

    await page.getByText(partTitle).first().click();
    await expect(page).toHaveURL(/\/orders\/[\w-]+/);

    // Dispatch now runs through the consequence-confirmation dialog: the
    // trigger opens it, carrier/tracking live inside, confirm submits.
    await page.getByRole("button", { name: /mark dispatched/i }).click();
    const dispatchDialog = page.getByRole("dialog");
    await dispatchDialog.getByLabel(/carrier/i).fill("Royal Mail");
    await dispatchDialog.getByLabel(/tracking/i).fill(`E2E${stamp}`);
    let interruptedDispatch = false;
    await page.route(`**${new URL(page.url()).pathname}`, async (route) => {
      if (!interruptedDispatch && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        interruptedDispatch = true;
        const response = await route.fetch();
        // Next 16.3 answers a fetch-action redirect 200 + x-action-redirect (16.2 sent 303).
        expect([200, 303]).toContain(response.status());
        expect(response.headers()["x-action-redirect"]).toContain("/orders/");
        await route.abort("failed");
      } else await route.continue();
    });
    await dispatchDialog.getByRole("button", { name: /mark dispatched/i }).click();
    await expect(dispatchDialog.getByRole("alert")).toContainText("Your details are still here");
    await expect(dispatchDialog.getByLabel(/carrier/i)).toHaveValue("Royal Mail");
    await expect(dispatchDialog.getByLabel(/tracking/i)).toHaveValue(`E2E${stamp}`);
    await dispatchDialog.getByRole("button", { name: /mark dispatched/i }).click();
    await expect(page.getByText(`E2E${stamp}`).first()).toBeVisible({ timeout: 30_000 });
  });

  test("buyer confirms receipt and reviews", async ({ page }) => {
    await signIn(page, buyer);
    await page.goto("/orders");
    // Click the ROW LINK (text alone may not be the anchor) and prove we
    // actually landed on the order before waiting on its controls.
    await page
      .getByRole("link", { name: new RegExp(partTitle.slice(0, 20)) })
      .first()
      .click();
    await page.waitForURL(/\/orders\/[\w-]+/);

    await page.getByRole("button", { name: /mark as received/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /mark as received/i }).click();
    await expect(page.locator("main").getByText("Rate this trade")).toBeVisible();

    // Reviews unlock only after delivery, and the rating is explicit — no
    // silent five stars. Choose one, then submit.
    // The rating is a radiogroup (explicit choice, no silent five stars).
    if (!(await page.getByRole("radio", { name: "5 stars" }).isVisible().catch(() => false))) {
      await page.reload(); // the review tile unlocks with the delivered status
    }
    await page.getByRole("radio", { name: "5 stars" }).click();
    const reviewBody = `Reliable seller — recovery check ${stamp}`;
    const reviewInput = page.getByRole("textbox", { name: /review.*optional/i });
    await reviewInput.fill(reviewBody);
    let interruptedReview = false;
    await page.route(`**${new URL(page.url()).pathname}`, async (route) => {
      if (!interruptedReview && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        interruptedReview = true;
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: /leave review/i }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("rating and text are still here");
    await expect(reviewInput).toHaveValue(reviewBody);
    await expect(page.getByRole("radio", { name: "5 stars" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: /leave review/i }).click();
    await expect(
      page.locator("main").getByText(/review filed|thanks|your review/i).first()
    ).toBeVisible();
    const reviews = await fixtureAdmin().from("reviews").select("id")
      .eq("order_id", new URL(page.url()).pathname.split("/").at(-1)!)
      .eq("body", reviewBody);
    if (reviews.error) throw reviews.error;
    expect(reviews.data).toHaveLength(1);
  });

  test("the review shows on the seller's public profile", async ({ page }) => {
    await page.goto(`/u/${seller.username}?view=reviews`);
    await expect(page.getByRole("tab", { name: /reviews/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // RatingStars announces the score through visually-hidden text
    // ("N out of 5 stars"), not an aria-label.
    await expect(page.getByText(/out of 5 stars/i).first()).toBeAttached();
  });
});

test.afterAll(async () => {
  // Cleanup needs the service role; skip quietly when it isn't configured so a
  // local run without it still reports test results rather than an error.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Both key generations, matching src/lib/env.ts.
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("[e2e] cleanup skipped: no service key configured — test users were NOT removed");
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data } = await admin.auth.admin.listUsers();
  for (const user of data?.users ?? []) {
    if (user.email === seller.email || user.email === buyer.email) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }
});
