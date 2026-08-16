import { expect, test, type Page } from "@playwright/test";

import { enableSellerPayouts } from "./helpers";

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

async function signUp(page: Page, user: typeof seller) {
  await page.goto("/signup");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  // Specific on purpose: dev mode adds an "Open Next.js Dev Tools" button that
  // a loose /open/i matcher collides with under strict mode.
  await page.getByRole("button", { name: /sign up|create account/i }).click();

  // With email confirmation off, signup lands on onboarding.
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel(/handle|username/i).fill(user.username);
  await page.getByLabel(/display name|keeper name/i).fill(user.displayName);
  await page.getByRole("button", { name: /continue|finish|save|let.s go/i }).click();
  await page.waitForURL(/\/home/);
}

async function signIn(page: Page, user: typeof seller) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(/\/home/);
}

test.describe.serial("golden path", () => {
  test("seller signs up and adds a car", async ({ page }) => {
    await signUp(page, seller);

    await page.goto("/garage");
    await page.getByRole("button", { name: /add a car|add car/i }).first().click();
    const addCarDialog = page.getByRole("dialog");
    await addCarDialog.getByLabel(/name/i).first().fill(carName);
    // "Add the car" (unanchored: the bracket decorations are part of the
    // accessible name), NOT bare /add/ — the dialog's auto-appended
    // "Close Add a car" button matches that too.
    await addCarDialog.getByRole("button", { name: /add the car/i }).click();

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

    await page.getByRole("button", { name: /publish/i }).click();

    await expect(page).toHaveURL(/\/listings\/[\w-]+/);
    await expect(page.getByRole("heading", { name: partTitle })).toBeVisible();
  });

  test("the part appears on the car sheet's For sale tab", async ({ page }) => {
    await signIn(page, seller);
    await page.goto("/garage");
    await page.getByRole("link", { name: /view build|public sheet/i }).first().click();

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
    await page.locator(".mkt a", { hasText: partTitle }).first().click();
    await expect(page).toHaveURL(/\/listings\/[\w-]+/);

    // Add-to-cart stays on the listing (in-place confirmation, badge update);
    // going to the cart is the buyer's own step.
    await page.getByRole("button", { name: /add to cart/i }).click();
    await expect(page.getByText(/added to cart/i).first()).toBeVisible();
    await page.goto("/cart");
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
    await expect(page.locator(".mkt").getByText(partTitle)).toHaveCount(0);
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
    // Click-until-applied: the sheet's remount churn can swallow a single
    // click, and the dialog's own copy contains "dispatched" — so the only
    // honest success signal is the tracking number rendered on the ORDER,
    // outside any dialog.
    for (let attempt = 0; attempt < 30; attempt++) {
      const applied = await page.evaluate((needle) => {
        const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(
          (d) => (d as HTMLElement).offsetParent !== null
        );
        const confirm = dialogs
          .flatMap((d) => [...d.querySelectorAll("button")])
          .find((b) => b.textContent?.includes("Mark dispatched"));
        if (confirm) {
          confirm.click();
          return false;
        }
        // Dialog gone — has the tracking number landed on the sheet?
        return (document.body.textContent ?? "").includes(needle);
      }, `E2E${stamp}`);
      if (applied) break;
      await page.waitForTimeout(500);
    }
    // In-place RSC refresh can lag behind the action — fresh server HTML is
    // the authoritative check either way.
    if (!(await page.getByText(`E2E${stamp}`).first().isVisible().catch(() => false))) {
      await page.reload();
    }
    await expect(page.getByText(`E2E${stamp}`).first()).toBeVisible();
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

    // Mark-received confirms through the consequence dialog (payout clearing
    // starts here — the dialog says so before the click).
    // Direct DOM activation: this sheet re-hydrates/remounts enough that
    // Playwright's actionability retries starve on a "detached" element.
    // Clicking the live node at call time sidesteps the churn. (Known
    // limitation, worth a look: the buyer order sheet remounts repeatedly
    // after load.)
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some((b) =>
        b.textContent?.includes("Mark as received")
      )
    );
    // Click-until-applied: one pass per tick — open the dialog if closed,
    // click its confirm if open, and only stop when the ORDER ITSELF proves
    // the transition (the review tile / "Rate this trade" only exists once
    // the order is delivered — dialog copy can't fake that).
    for (let attempt = 0; attempt < 40; attempt++) {
      const applied = await page.evaluate(() => {
        const main = document.querySelector("main");
        if (main?.textContent?.includes("Rate this trade")) return true;
        const dialog = [...document.querySelectorAll('[role="dialog"]')].find(
          (d) =>
            (d as HTMLElement).offsetParent !== null &&
            /mark as received/i.test(d.textContent ?? "")
        );
        const scope = dialog ?? main ?? document;
        const btn = [...scope.querySelectorAll("button")].find((b) =>
          b.textContent?.includes("Mark as received")
        );
        btn?.click();
        return false;
      });
      if (applied) break;
      await page.waitForTimeout(500);
    }
    if (
      !(await page.locator("main").getByText("Rate this trade").isVisible().catch(() => false))
    ) {
      await page.reload(); // authoritative server HTML
    }
    await expect(page.locator("main").getByText("Rate this trade")).toBeVisible();

    // Reviews unlock only after delivery, and the rating is explicit — no
    // silent five stars. Choose one, then submit.
    // The rating is a radiogroup (explicit choice, no silent five stars).
    if (!(await page.getByRole("radio", { name: "5 stars" }).isVisible().catch(() => false))) {
      await page.reload(); // the review tile unlocks with the delivered status
    }
    await page.getByRole("radio", { name: "5 stars" }).click();
    await page.getByRole("button", { name: /leave review/i }).click();
    await expect(
      page.locator("main").getByText(/review filed|thanks|your review/i).first()
    ).toBeVisible();
  });

  test("the review shows on the seller's public profile", async ({ page }) => {
    await page.goto(`/u/${seller.username}?view=reviews`);
    await expect(page.getByRole("tab", { name: /reviews/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByLabel(/out of 5/i).first()).toBeVisible();
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
    if (user.email?.startsWith("e2e-") && user.email.endsWith("@drvn.test")) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }
});
