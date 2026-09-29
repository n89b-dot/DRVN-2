import { expect, test } from "@playwright/test";

import {
  cleanupE2eUsers,
  enableSellerPayouts,
  makeUser,
  publishListing,
  signIn,
  signUp,
} from "./helpers";

/**
 * Feature-level regressions from the Aug 2026 remediation:
 * part-number search (raw and separator-stripped), shipping visibility on
 * marketplace cards, the messages → offers navigation, and the /home greeting.
 */

const stamp = Date.now();
const seller = makeUser("fr-seller", stamp);

const PART_NUMBER = "11-42-7-566-327";
const PART_NUMBER_COMPACT = "11427566327";
const pnTitle = `E2E PN Downpipe ${stamp}`;
const freeShipTitle = `E2E Free Ship Gasket ${stamp}`;

test.describe.serial("feature regressions", () => {
  test("seller lists a part-numbered listing and a free-shipping listing", async ({ page }) => {
    await signUp(page, seller);
    await enableSellerPayouts(seller.username);
    await publishListing(page, {
      title: pnTitle,
      price: "180",
      shipping: "25",
      partNumber: PART_NUMBER,
    });
    await publishListing(page, {
      title: freeShipTitle,
      price: "90",
      shipping: "0",
    });
  });

  test("marketplace search matches the raw part number", async ({ page }) => {
    // Anonymous: search must work without an account. Listing navigation
    // must not reuse a racing partial-prefetch payload with an empty body.
    const prefetchedListings: string[] = [];
    page.on("request", (request) => {
      const headers = request.headers();
      if (/\/listings\/[0-9a-f-]+(?:\?|$)/.test(request.url()) &&
          (headers["next-router-prefetch"] || headers["next-router-segment-prefetch"])) {
        prefetchedListings.push(request.url());
      }
    });
    await page.goto(`/marketplace?q=${encodeURIComponent(PART_NUMBER)}`);
    await expect(page.locator(".mosaic").getByText(pnTitle)).toBeVisible();
    // The shopping card and detail both preserve the original identifier.
    await page.locator(".mosaic a.marketplace-card__link", { hasText: pnTitle }).first().click();
    await expect(page.getByRole("heading", { name: pnTitle, exact: true })).toBeVisible();
    await expect(page.getByText(PART_NUMBER).first()).toBeVisible();
    expect(prefetchedListings).toEqual([]);
  });

  test("marketplace search matches the compact part number", async ({ page }) => {
    // KNOWN APP GAP (src/lib/marketplace/query.ts): the search only strips
    // separators from the QUERY (`compact` clause), so a separator-less query
    // like "11427566327" matches via the stored generated column
    // part_number_compact (migration 0033) — both sides normalised.
    await page.goto(`/marketplace?q=${PART_NUMBER_COMPACT}`);
    await expect(page.locator(".mosaic").getByText(pnTitle)).toBeVisible();
  });

  test("marketplace cards state the shipping cost", async ({ page }) => {
    await page.goto(`/marketplace?q=${encodeURIComponent(pnTitle)}`);
    const paidCard = page.locator(".mosaic a.marketplace-card__link", { hasText: pnTitle }).first();
    // formatPrice drops trailing .00 for whole dollars — accept either form.
    // The card says "ship", not "shipping": the line truncates in a card
    // footer, so the copy is deliberately terse.
    await expect(paidCard.getByText(/shipping/)).toHaveText(/\+ \$25(\.00)? ship/);

    await page.goto(`/marketplace?q=${encodeURIComponent(freeShipTitle)}`);
    const freeCard = page.locator(".mosaic a.marketplace-card__link", { hasText: freeShipTitle }).first();
    await expect(freeCard.getByText(/Shipping included/)).toHaveText(/Shipping included/i);
  });

  test("messages inbox filters by side of the deal", async ({ page }) => {
    await signIn(page, seller);
    await page.goto("/messages");
    await expect(page.getByRole("link", { name: /^selling/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^buying/i })).toBeVisible();
  });

  test("home greets by time of day", async ({ page }) => {
    await signIn(page, seller);
    await page.goto("/home");
    await expect(page.locator("h1").first()).toContainText(/Morning|Afternoon|Evening/);
  });
});

test.afterAll(async () => {
  await cleanupE2eUsers();
});
