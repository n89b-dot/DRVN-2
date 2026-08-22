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
    // Anonymous: search must work without an account.
    await page.goto(`/marketplace?q=${encodeURIComponent(PART_NUMBER)}`);
    await expect(page.locator(".mosaic").getByText(pnTitle)).toBeVisible();
    // The card no longer prints the part number (22 Aug 2026: the mosaic
    // card's top line is the source car); the listing page still does.
    await page.locator(".mosaic a.mcell", { hasText: pnTitle }).first().click();
    await expect(page.getByText(PART_NUMBER).first()).toBeVisible();
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
    const paidCard = page.locator(".mosaic a.mcell", { hasText: pnTitle }).first();
    // formatPrice drops trailing .00 for whole dollars — accept either form.
    // The card says "ship", not "shipping": the line truncates in a card
    // footer, so the copy is deliberately terse.
    await expect(paidCard.locator(".mcell__ship")).toHaveText(/\+ \$25(\.00)? ship/);

    await page.goto(`/marketplace?q=${encodeURIComponent(freeShipTitle)}`);
    const freeCard = page.locator(".mosaic a.mcell", { hasText: freeShipTitle }).first();
    await expect(freeCard.locator(".mcell__ship")).toHaveText(/ships free/i);
  });

  test("messages footer links to offers", async ({ page }) => {
    await signIn(page, seller);
    await page.goto("/messages");
    await expect(page.locator('footer.foot a[href="/offers"]')).toBeVisible();
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
