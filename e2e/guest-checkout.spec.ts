import { expect, test, type Page } from "@playwright/test";

import {
  cleanupE2eUsers,
  enableSellerPayouts,
  makeUser,
  publishListing,
  signUp,
} from "./helpers";

/**
 * Guest purchase — buying is the service, not an account feature.
 *
 * A visitor with no account must be able to go listing → cart → checkout and
 * pay, identifying themselves with the email a receipt has to go to anyway.
 * What these protect:
 *   · Buy now and Add to cart never demand an account.
 *   · /cart and /checkout are publicly reachable, /orders and /sell are not.
 *   · Checkout creates a real, claimable account and a real order attached to
 *     it, so RLS, disputes, payouts and messaging keep working unchanged.
 *   · A guest checkout against a member's (proven) email is refused with a
 *     "sign in" prompt — typing an address never puts an order in someone
 *     else's account (20261005101000) — and no duplicate account is made.
 *   · Making an offer is still gated — that one genuinely needs an identity.
 *
 * Not covered here: confirming the card in Stripe's iframe. The tests stop at
 * the payment step, which is the last deterministic point and already proves
 * the account and the orders exist.
 */

const stamp = Date.now();
const seller = makeUser("guest-seller", stamp);
const member = makeUser("guest-member", stamp);
const guestEmail = `e2e-guest-${stamp}@drvn.test`;

// A checkout reserves the listing it buys, so each purchasing test needs its
// own part — a reserved listing renders no Buy now button at all.
let listingPath = "";
let listingTitle = "";
let memberListingPath = "";
let spareListingPath = "";

async function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("guest-checkout spec needs a Supabase service key");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Fills the checkout's shipping step (plus the guest email when present). */
async function fillCheckout(page: Page, email: string | null) {
  if (email) {
    await page.locator('input[name="email"]').fill(email);
    // R69-age: a guest confirms 18+ before the order (and its email) exists.
    await page.getByLabel(/18 or over/i).check();
  }
  await page.locator('input[name="ship_name"]').fill("Guest Buyer");
  await page.locator('input[name="ship_line1"]').fill("1 Test Street");
  await page.locator('input[name="ship_city"]').fill("Reno");
  await page.locator('input[name="ship_postcode"]').fill("89501");
  // Checkout's country starts on the United States (11713ff), where State is
  // required. The visible select is addressed by id (it submits through a
  // state-bound hidden input — see checkout-steps).
  await page.locator("#checkout-ship-country").selectOption("US");
  await page.getByLabel(/state \/ province/i).fill("NV");
  await page.getByRole("button", { name: /continue to payment/i }).first().click();
}

test.describe.serial("guest checkout", () => {
  test("seller publishes a part for a guest to buy", async ({ page }) => {
    await signUp(page, seller);
    await enableSellerPayouts(seller.username);
    listingTitle = `E2E Guest Turbo ${stamp}`;
    listingPath = await publishListing(page, {
      title: listingTitle,
      price: "300",
      shipping: "15",
    });
    memberListingPath = await publishListing(page, {
      title: `E2E Guest Manifold ${stamp}`,
      price: "120",
      shipping: "10",
    });
    spareListingPath = await publishListing(page, {
      title: `E2E Guest Clutch ${stamp}`,
      price: "90",
      shipping: "5",
    });
  });

  test("cart and checkout are public; orders and sell are not", async ({ page }) => {
    await page.context().clearCookies();

    for (const path of ["/cart", "/checkout"]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} should be reachable as a guest`).toBeLessThan(400);
      await expect(page, `${path} must not bounce to login`).not.toHaveURL(/\/login/);
    }

    for (const path of ["/orders", "/sell"]) {
      await page.goto(path);
      await expect(page, `${path} should still require an account`).toHaveURL(/\/login/);
    }
  });

  test("Buy now works signed out — no account demanded", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(listingPath);

    await page.getByRole("button", { name: /buy now/i }).first().click();

    // Straight to the cart, not to /login and not into an auth dialog.
    await expect(page).toHaveURL(/\/cart/);
    await expect(page.getByText(listingTitle).first()).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Add to cart works signed out", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(listingPath);

    await page.getByRole("button", { name: /add to cart/i }).first().click();
    await expect(page.getByText(/in cart|added to cart/i).first()).toBeVisible();
  });

  test("a guest pays with an email and gets a real, claimable order", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(listingPath);
    await page.getByRole("button", { name: /buy now/i }).first().click();
    await expect(page).toHaveURL(/\/cart/);

    await page.getByRole("link", { name: /proceed to checkout/i }).first().click();
    await expect(page).toHaveURL(/\/checkout/);

    // The one extra field a guest sees — and it explains itself.
    const email = page.locator('input[name="email"]');
    await expect(email).toBeVisible();
    await expect(page.getByText(/no password needed|no account to create/i)).toBeVisible();

    await fillCheckout(page, guestEmail);

    // Reaching the payment step means the orders were created — which means a
    // buyer account was resolved for an address that had never been seen.
    // Either outcome proves the orders were created: the Stripe-mode payment-step review ("Delivery & contact") renders only once the action returns a PaymentIntent, and stub mode settles inline onto the placed order;
    // the stepper's "Payment" label is on screen from the start and proves
    // nothing.
    await expect(page.getByText(/delivery & contact|order placed|paid and confirmed/i).first()).toBeVisible({ timeout: 30_000 });

    const admin = await serviceClient();
    const { data: account } = await admin
      .from("account_emails")
      .select("user_id")
      .eq("email", guestEmail.toLowerCase())
      .maybeSingle();
    expect(account?.user_id, "guest checkout should have created an account").toBeTruthy();

    const { data: orders } = await admin
      .from("orders")
      .select("id, buyer_id, ship_name, total_cents")
      .eq("buyer_id", account!.user_id);
    expect(orders?.length, "the guest's order should exist").toBeGreaterThan(0);
    expect(orders![0].ship_name).toBe("Guest Buyer");

    // The account is claimable, not usable: no password, and unconfirmed until
    // the emailed link is opened.
    const { data: profile } = await admin
      .from("profiles")
      .select("username, display_name")
      .eq("id", account!.user_id)
      .maybeSingle();
    expect(profile?.username, "a guest account has no handle until onboarding").toBeNull();
    expect(profile?.display_name).toBe("Guest Buyer");
  });

  test("a guest checkout on a member's email is refused, not attached", async ({ page }) => {
    await signUp(page, member);
    const admin = await serviceClient();
    const { data: before } = await admin
      .from("account_emails")
      .select("user_id")
      .eq("email", member.email.toLowerCase())
      .maybeSingle();
    expect(before?.user_id).toBeTruthy();

    // Now shop as a guest, using the member's address.
    await page.context().clearCookies();
    await page.goto(memberListingPath);
    await page.getByRole("button", { name: /buy now/i }).first().click();
    await page.getByRole("link", { name: /proceed to checkout/i }).first().click();
    await fillCheckout(page, member.email);
    await expect(page.getByText(/already has a drvn account\. sign in/i).first()).toBeVisible({ timeout: 30_000 });

    // No order landed in the member's account, and no duplicate was made.
    const { data: orders } = await admin.from("orders").select("id").eq("buyer_id", before!.user_id);
    expect(orders ?? [], "a typed email must not place an order in a member's account").toHaveLength(0);
    const { data: after } = await admin
      .from("account_emails")
      .select("user_id")
      .eq("email", member.email.toLowerCase());
    expect(after?.length, "no duplicate account for a known address").toBe(1);
    expect(after![0].user_id).toBe(before!.user_id);

    // …and their own display name was not overwritten by the delivery name.
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", before!.user_id)
      .maybeSingle();
    expect(profile?.display_name).toBe(member.displayName);
  });

  test("checkout refuses an implausible email before charging anything", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(spareListingPath);
    await page.getByRole("button", { name: /buy now/i }).first().click();
    await page.getByRole("link", { name: /proceed to checkout/i }).first().click();

    // Bypass the browser's own type=email validation to reach the server check.
    await page.locator('input[name="email"]').evaluate((el: HTMLInputElement) => {
      el.type = "text";
      el.value = "no@domain";
    });
    await page.getByLabel(/18 or over/i).check();
    await page.locator('input[name="ship_name"]').fill("Guest Buyer");
    await page.locator('input[name="ship_line1"]').fill("1 Test Street");
    await page.locator('input[name="ship_city"]').fill("Reno");
    await page.locator('input[name="ship_postcode"]').fill("89501");
    await page.locator("#checkout-ship-country").selectOption("US");
    await page.getByLabel(/state \/ province/i).fill("NV");
    await page.getByRole("button", { name: /continue to payment/i }).first().click();

    await expect(page.getByText(/email doesn't look right/i)).toBeVisible();
  });

  test("making an offer is still gated — that one needs an identity", async ({ page }) => {
    await page.context().clearCookies();
    // The spare part is still active: the invalid-email test above is refused
    // before `purchase_begin`, so nothing was ever reserved.
    await page.goto(spareListingPath);

    await page.getByRole("button", { name: "Make an offer" }).first().click();
    await expect(page.getByRole("dialog", { name: /sign in to make an offer/i })).toBeVisible();
  });

  test.afterAll(async () => {
    // The guest account uses the same e2e-*@drvn.test pattern as the rest.
    await cleanupE2eUsers();
  });
});
