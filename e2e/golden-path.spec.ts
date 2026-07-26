import { expect, test, type Page } from "@playwright/test";

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
  await page.getByRole("button", { name: /open|sign up|create/i }).click();

  // With email confirmation off, signup lands on onboarding.
  await page.waitForURL(/\/onboarding/);
  await page.getByLabel(/username/i).fill(user.username);
  await page.getByLabel(/display name|keeper name/i).fill(user.displayName);
  await page.getByRole("button", { name: /continue|finish|save/i }).click();
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
    await page.getByRole("button", { name: /add a car|add car/i }).click();
    await page.getByLabel(/name/i).first().fill(carName);
    await page.getByRole("button", { name: /add|create|save/i }).last().click();

    // Lands on the car's edit page.
    await expect(page).toHaveURL(/\/garage\/[\w-]+\/edit/);
    await expect(page.getByText(carName).first()).toBeVisible();
  });

  test("seller lists a part off that car", async ({ page }) => {
    await signIn(page, seller);
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
    await page.getByRole("link", { name: /public sheet/i }).first().click();

    await page.getByRole("tab", { name: /for sale/i }).click();
    await expect(page.getByText(partTitle)).toBeVisible();

    // The tab is deep-linkable: that was the point of URL-backed state.
    await expect(page).toHaveURL(/[?&]view=forsale/);
  });

  test("buyer finds the part and buys it", async ({ page }) => {
    await signUp(page, buyer);

    await page.goto(`/marketplace?q=${encodeURIComponent(partTitle)}`);
    await page.getByText(partTitle).first().click();
    await expect(page).toHaveURL(/\/listings\/[\w-]+/);

    await page.getByRole("button", { name: /add to cart/i }).click();
    await expect(page).toHaveURL(/\/cart/);

    // Checkout collects a delivery address.
    await page.getByLabel(/^name/i).fill("E2E Buyer");
    await page.getByLabel(/^address$/i).fill("1 Test Street");
    await page.getByLabel(/city/i).fill("Testville");
    await page.getByLabel(/postcode/i).fill("TE5 7ST");
    await page.getByLabel(/country/i).fill("United Kingdom");
    await page.getByRole("button", { name: /confirm and pay/i }).click();

    await expect(page).toHaveURL(/\/orders/);
    await expect(page.getByText(/order placed/i)).toBeVisible();
  });

  test("the listing is now sold, not buyable twice", async ({ page }) => {
    await signIn(page, buyer);
    await page.goto(`/marketplace?q=${encodeURIComponent(partTitle)}`);

    // Sold parts leave the active market.
    await expect(page.getByText(partTitle)).toHaveCount(0);
  });

  test("seller dispatches with tracking", async ({ page }) => {
    await signIn(page, seller);
    await page.goto("/orders");

    await page.getByText(partTitle).first().click();
    await expect(page).toHaveURL(/\/orders\/[\w-]+/);

    await page.getByLabel(/carrier/i).fill("Royal Mail");
    await page.getByLabel(/tracking/i).fill(`E2E${stamp}`);
    await page.getByRole("button", { name: /mark dispatched/i }).click();

    await expect(page.getByText(/dispatched/i).first()).toBeVisible();
  });

  test("buyer confirms receipt and reviews", async ({ page }) => {
    await signIn(page, buyer);
    await page.goto("/orders");
    await page.getByText(partTitle).first().click();

    await page.getByRole("button", { name: /mark as received/i }).click();
    await expect(page.getByText(/received|delivered/i).first()).toBeVisible();

    // Reviews unlock only after delivery — that gate is the point.
    await page.getByRole("button", { name: /leave review/i }).click();
    await expect(page.getByText(/review filed|thanks/i)).toBeVisible();
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
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data } = await admin.auth.admin.listUsers();
  for (const user of data?.users ?? []) {
    if (user.email?.startsWith("e2e-") && user.email.endsWith("@drvn.test")) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }
});
