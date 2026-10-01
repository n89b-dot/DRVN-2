import { expect, test, type Page } from "@playwright/test";

import {
  cleanupE2eUsers,
  enableSellerPayouts,
  makeUser,
  publishListing,
  signIn,
  signUp,
} from "./helpers";

/**
 * The Marketplace family — Marketplace | My Listings | Offers | Orders — as one
 * navigational group across four independent routes, plus the auth-intent
 * path a signed-out visitor takes to make an offer.
 *
 * What these actually protect:
 *   · Marketplace stays public; the three management surfaces stay gated.
 *   · Every child is reachable in one interaction from anywhere in the family
 *     and from the mobile index — never via Marketplace first.
 *   · Make an offer while signed out explains itself instead of dumping the
 *     visitor on /login, and the intent survives sign-in and signup.
 *   · `?next=` cannot be turned into an open redirect.
 */

const stamp = Date.now();
const seller = makeUser("fam-seller", stamp);
const buyer = makeUser("fam-buyer", stamp);
const listingTitle = `E2E Family Manifold ${stamp}`;

let listingPath = "";

/** The Selling family subnav, wherever it is on the page. */
function familyNav(page: Page) {
  return page.getByRole("navigation", { name: /selling sections/i });
}

test.describe.serial("Marketplace family", () => {
  test("seller publishes a part to negotiate over", async ({ page }) => {
    await signUp(page, seller);
    await enableSellerPayouts(seller.username);
    listingPath = await publishListing(page, {
      title: listingTitle,
      price: "420",
      shipping: "20",
    });
    expect(listingPath).toMatch(/^\/listings\//);
  });

  // ---------- the authentication boundary ----------

  test("signed out: marketplace and listing sheets stay public", async ({ page }) => {
    await page.context().clearCookies();

    await page.goto("/marketplace");
    await expect(page).toHaveURL(/\/marketplace/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.goto(listingPath);
    await expect(page).toHaveURL(new RegExp(listingPath));
    await expect(page.getByText(listingTitle).first()).toBeVisible();
  });

  test("signed out: the management surfaces are gated and never advertised", async ({ page }) => {
    await page.context().clearCookies();

    for (const path of ["/selling", "/listings", "/offers", "/orders", "/payouts"]) {
      await page.goto(path);
      await expect(page, `${path} should require an account`).toHaveURL(/\/login/);
    }

    // And the public index offers no route to them. The index button only
    // exists at ≤1080px — above that the bar carries text links instead.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/marketplace");
    await expect(familyNav(page)).toHaveCount(0);
    await page.getByRole("button", { name: /open the index/i }).click();
    const index = page.getByRole("dialog", { name: /navigation index/i });
    // Index rows carry their register number and note in the accessible name,
    // so the destination itself is the stable thing to assert on.
    const hrefs = await index.locator("a").evaluateAll((els) =>
      els.map((el) => el.getAttribute("href"))
    );
    expect(hrefs).toContain("/marketplace");
    for (const surface of ["/selling", "/listings", "/offers", "/orders", "/payouts"]) {
      expect(hrefs, `${surface} advertised while signed out`).not.toContain(surface);
    }
  });

  // ---------- the family, signed in ----------

  test("signed in: every Selling child is one interaction away, from anywhere in the family", async ({
    page,
  }) => {
    // The Selling plate is the family nav below 1081px; at desktop widths the
    // rail carries the same links and the plate stands down (selling-nav.tsx).
    await page.setViewportSize({ width: 768, height: 1024 });
    await signIn(page, seller);

    // Marketplace is discovery — it carries no operational family strip.
    await page.goto("/marketplace");
    await expect(familyNav(page)).toHaveCount(0);

    // The Selling overview reaches every child directly.
    await page.goto("/selling");
    await expect(familyNav(page)).toBeVisible();
    await familyNav(page).getByRole("link", { name: "Orders" }).click();
    await expect(page).toHaveURL(/\/orders/);
    await expect(
      familyNav(page).getByRole("link", { name: "Orders" })
    ).toHaveAttribute("aria-current", "page");

    // Orders → My Listings, still one click.
    await familyNav(page).getByRole("link", { name: "My Listings" }).click();
    await expect(page).toHaveURL(/\/listings$/);

    // Listings → Offers → Payouts.
    await familyNav(page).getByRole("link", { name: "Offers" }).click();
    await expect(page).toHaveURL(/\/offers/);
    await familyNav(page).getByRole("link", { name: "Payouts" }).click();
    await expect(page).toHaveURL(/\/payouts/);
  });

  test("signed in: the mobile index reaches Orders without going via Marketplace", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, seller);
    await page.goto("/home");

    const index = page.getByRole("dialog", { name: /navigation index/i });
    // A click that lands before the bar has hydrated does nothing, and
    // `evaluateAll` below doesn't wait — so open it until it IS open.
    await expect(async () => {
      if (!(await index.locator('a[href="/marketplace"]').isVisible())) {
        await page.getByRole("button", { name: /open the index/i }).click();
      }
      await expect(index.locator('a[href="/marketplace"]')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    // The family reads as a heading with its four children directly beneath.
    const hrefs = await index.locator("a").evaluateAll((els) =>
      els.map((el) => el.getAttribute("href"))
    );
    for (const href of ["/marketplace", "/selling", "/listings", "/offers", "/orders", "/payouts"]) {
      expect(hrefs, `${href} missing from the index`).toContain(href);
    }

    // Index → Orders directly: no intermediate Marketplace stop.
    await index.locator('a[href="/orders"]').click();
    await expect(page).toHaveURL(/\/orders/);
  });

  test("signed in: a public listing sheet reads as Marketplace, the seller's register as My Listings", async ({
    page,
  }) => {
    // The Selling plate is the family nav below 1081px (selling-nav.tsx).
    await page.setViewportSize({ width: 768, height: 1024 });
    await signIn(page, seller);

    await page.goto("/listings");
    await expect(familyNav(page).getByRole("link", { name: "My Listings" })).toHaveAttribute(
      "aria-current",
      "page"
    );

    await page.goto("/orders");
    await expect(familyNav(page).getByRole("link", { name: "Orders" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  // ---------- Listings → Offers deep link ----------

  test("the ledger hands a listing to Offers rather than re-implementing offers", async ({
    page,
  }) => {
    await signIn(page, seller);
    await page.goto("/listings");

    // The full offer product must not be inside a listing row any more.
    await expect(page.getByRole("link", { name: /answer offers in orders/i })).toHaveCount(0);

    const listingId = listingPath.split("/").pop();
    await page.goto(`/offers?role=received&listing=${listingId}`);
    // Scoped to the page body: the index sheet carries "…offers on what
    // you're selling" as a route note, which a bare text match would find.
    const main = page.getByRole("main");
    await expect(main.getByText(/offers on/i).first()).toBeVisible();
    await expect(main.getByText(listingTitle).first()).toBeVisible();
    await expect(main.getByRole("link", { name: /clear filter/i })).toBeVisible();
  });

  // ---------- signed-out transaction intent ----------

  test("Make an offer while signed out explains why an account is needed", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(listingPath);

    await page.getByRole("button", { name: "Make an offer" }).first().click();

    const dialog = page.getByRole("dialog", { name: /sign in to make an offer/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/notif|counter|track/i).first()).toBeVisible();
    await expect(dialog.getByRole("link", { name: /create account/i })).toBeVisible();

    // Escape closes it and the visitor stays on the public listing.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(listingPath));
  });

  test("signing in from the offer dialog returns to the listing with the offer form open", async ({
    page,
  }) => {
    await signUp(page, buyer);
    await page.context().clearCookies();

    await page.goto(listingPath);
    await page.getByRole("button", { name: "Make an offer" }).first().click();
    await page.getByRole("dialog", { name: "Sign in to make an offer" }).getByRole("link", { name: /^\[?\s*Sign in\s*\]?$/ }).click();

    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel(/email/i).fill(buyer.email);
    await page.getByLabel(/^password$/i).fill(buyer.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(new RegExp(listingPath));
    // The intent resumed: the offer dialog is open, not the bare listing.
    await expect(page.getByRole("dialog", { name: /make an offer/i })).toBeVisible();
    // …and the URL was cleaned so a refresh doesn't reopen it forever.
    await expect(page).toHaveURL(new RegExp(`${listingPath}$`));
  });

  test("creating an account from the offer dialog keeps the same intent", async ({ page }) => {
    await page.context().clearCookies();
    const newcomer = makeUser("fam-new", stamp);

    await page.goto(listingPath);
    await page.getByRole("button", { name: "Make an offer" }).first().click();
    await page.getByRole("link", { name: /create account/i }).click();

    // Signup accepts the destination…
    await expect(page).toHaveURL(/\/signup\?next=/);
    await page.getByLabel(/email/i).fill(newcomer.email);
    await page.getByLabel(/^password$/i).fill(newcomer.password);
    await page.getByRole("button", { name: /create account/i }).click();

    // …and it survives onboarding, which used to end unconditionally at /home.
    await page.waitForURL(/\/onboarding\?next=/);
    await page.getByLabel(/handle|username/i).fill(newcomer.username);
    await page.getByLabel(/display name|keeper name/i).fill(newcomer.displayName);
    await page.getByRole("button", { name: /continue|finish|save|let.s go/i }).click();

    await expect(page).toHaveURL(new RegExp(listingPath));
    await expect(page.getByRole("dialog", { name: /make an offer/i })).toBeVisible();
  });

  test("the login/signup swap keeps the destination in both directions", async ({ page }) => {
    await page.context().clearCookies();
    const target = encodeURIComponent(`${listingPath}?action=offer`);

    await page.goto(`/login?next=${target}`);
    await page.getByRole("link", { name: /create an account/i }).click();
    await expect(page).toHaveURL(/\/signup\?next=/);

    await page.getByRole("link", { name: /already have an account/i }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("an off-site next is refused, not followed", async ({ page }) => {
    await page.context().clearCookies();

    for (const hostile of ["//example.com", "https://example.com/evil", "/\\example.com"]) {
      await page.goto(`/login?next=${encodeURIComponent(hostile)}`);
      await page.getByLabel(/email/i).fill(buyer.email);
      await page.getByLabel(/^password$/i).fill(buyer.password);
      await page.getByRole("button", { name: /sign in/i }).click();

      await page.waitForURL(/\/home/);
      expect(new URL(page.url()).hostname, `next=${hostile} escaped the origin`).toMatch(
        /localhost|127\.0\.0\.1/
      );
      await expect(page).toHaveURL(/\/home/);
      await page.context().clearCookies();
    }
  });

  // ---------- Orders no longer carries Offers' furniture ----------

  test("Orders drops the offers promo card and the offer-expiry footer", async ({ page }) => {
    // The Selling plate is the family nav below 1081px (selling-nav.tsx).
    await page.setViewportSize({ width: 768, height: 1024 });
    await signIn(page, buyer);
    await page.goto("/orders");

    await expect(page.getByRole("link", { name: /open offers/i })).toHaveCount(0);
    await expect(page.getByText(/offers expire 72 hours/i)).toHaveCount(0);
    // Offers is still one click away — via the family nav, not a content card.
    await expect(familyNav(page).getByRole("link", { name: "Offers" })).toBeVisible();
  });

  test("Orders groups states and keeps raw states addressable", async ({ page }) => {
    await signIn(page, buyer);

    await page.goto("/orders?state=active");
    await expect(page.getByRole("link", { name: "Active", exact: true })).toHaveAttribute(
      "aria-current",
      "true"
    );

    await page.goto("/orders?view=sales&status=paid");
    await expect(page).toHaveURL(/status=paid/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test.afterAll(async () => {
    await cleanupE2eUsers();
  });
});
