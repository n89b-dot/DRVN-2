import { expect, test, type Page } from "@playwright/test";

import {
  addCar,
  cleanupE2eUsers,
  enableSellerPayouts,
  makeUser,
  publishListing,
  signIn,
  signUp,
} from "./helpers";
import { PHONE_TIERS, VIEWPORTS } from "./viewports";

/**
 * The marketplace + discovery remediation (22 Aug 2026) as contracts:
 *
 *   · "My Listings" is what the seller's register is called, everywhere.
 *   · Home Discovery is segmented (All · Builds · Updates · Parts), URL-
 *     addressable, and separate from the followed feed.
 *   · Categories are navigation: a tile grid ≥640px, a Browse sheet on
 *     phones, real /marketplace/[category] routes either way.
 *   · Marketplace cards emphasize the part and Save; purchase continues on detail,
 *     and the card never nests interactives.
 *   · Engagement icons name themselves on keyboard focus.
 */

const stamp = Date.now();
const seller = makeUser("dr-seller", stamp);
const partTitle = `E2E Remediation Manifold ${stamp}`;
let listingPath = "";

async function assertNoNestedInteractives(page: Page, label: string) {
  const nested = await page
    .locator("a a, a button, button a, button button, a [role=button]")
    .count();
  expect(nested, `nested interactive elements on ${label}`).toBe(0);
}

test.describe.serial("discovery + marketplace remediation", () => {
  test("setup: a seller publishes a part", async ({ page }) => {
    await signUp(page, seller);
    await addCar(page, `Discovery fixture ${stamp}`);
    await enableSellerPayouts(seller.username);
    listingPath = await publishListing(page, { title: partTitle, price: "180", shipping: "12" });
    expect(listingPath).toMatch(/^\/listings\//);
  });

  // ---------- naming ----------

  test("the seller's register is called My Listings in the family nav, rail and index", async ({
    page,
  }) => {
    await signIn(page, seller);
    // The register moved into the Selling family (§J): discovery pages carry
    // no operational strip; sellers reach their stock from /selling.
    await page.goto("/selling");
    const nav = page.getByRole("navigation", { name: /selling sections/i });
    await expect(nav.getByRole("link", { name: "My Listings" })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^Listings$/ })).toHaveCount(0);
    await nav.getByRole("link", { name: "My Listings" }).click();
    await expect(page).toHaveURL(/\/listings$/);
    await expect(
      page.getByRole("navigation", { name: /selling sections/i }).getByRole("link", { name: "My Listings" })
    ).toHaveAttribute("aria-current", "page");

    // Desktop rail (≥1081px) and the phone index read the same register.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole("complementary", { name: /sections/i }).getByRole("link", { name: "My Listings" })).toBeVisible();
    await page.setViewportSize(VIEWPORTS.phone);
    await page.getByRole("button", { name: /open the index/i }).click();
    await expect(
      page.getByRole("dialog", { name: /navigation index/i }).locator('a[href="/listings"]')
    ).toContainText("My Listings");
  });

  // ---------- Home Discovery segmentation ----------

  test("Home Discovery is segmented and URL-addressable", async ({ page }) => {
    await signIn(page, seller);
    await page.goto("/home");

    const segments = page.getByRole("group", { name: /discovery segments/i });
    await expect(segments).toBeVisible();
    await expect(segments.getByRole("link")).toHaveText(["All", "Builds", "Updates", "Parts"]);
    await expect(segments.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "true");

    await segments.getByRole("link", { name: "Parts" }).click();
    await expect(page).toHaveURL(/\/home\?discover=parts$/);
    await expect(
      page.getByRole("group", { name: /discovery segments/i }).getByRole("link", { name: "Parts" })
    ).toHaveAttribute("aria-current", "true");
    // The segment renders either its rows or its own named empty state —
    // never a blank section. Our seller's part is active, so rows here.
    const discovery = page.locator("section[aria-labelledby='discovery-head']");
    await expect(discovery.locator(".rowlist, .undrawn").first()).toBeVisible();
    await expect(discovery.getByText(partTitle)).toBeVisible();

    // Unknown segment falls back to All instead of an empty page.
    await page.goto("/home?discover=for-sale");
    await expect(
      page.getByRole("group", { name: /discovery segments/i }).getByRole("link", { name: "All" })
    ).toHaveAttribute("aria-current", "true");

    // Phones: all four segments share one row.
    await page.setViewportSize(VIEWPORTS.compactShort);
    await page.goto("/home");
    const phoneSegments = page.getByRole("group", { name: /discovery segments/i }).getByRole("link");
    await expect(phoneSegments).toHaveCount(4);
    const rows = await phoneSegments.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    expect(rows, "discovery segments must fit one row at 320px").toBe(1);
  });

  // ---------- category navigation ----------

  test("categories are destinations: tiles on desktop, a Browse sheet on phones", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/marketplace");

    const grid = page.getByRole("navigation", { name: /browse by category/i });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole("link", { name: /all parts/i })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: /Browse categories/ }).click();
    await page.getByRole("dialog", { name: "Browse by category" }).getByRole("link", { name: /brakes & suspension/i }).click();
    await expect(page).toHaveURL(/\/marketplace\/brakes-suspension$/);
    // Category page narrows to its subcategories, as tiles.
    const sub = page.getByRole("navigation", { name: /browse brakes & suspension/i });
    await expect(sub).toBeVisible();
    await page.getByRole("button", { name: /Browse categories/ }).click();
    await page.getByRole("dialog", { name: "Browse by category" }).getByRole("link", { name: /coilovers/i }).click();
    await expect(page).toHaveURL(/\/marketplace\/brakes-suspension\/coilovers$/);
    // Leaf: the category tree remains available without repeating tiles.
    await expect(page.getByRole("navigation", { name: "Browse by category", exact: true })).toBeVisible();
    await expect(page.locator(".catgrid")).toHaveCount(0);
    // Search/refine survive on the category route.
    await page.getByLabel(/search parts/i).fill("coil");
    // The submit's accessible name carries the `[ ]` bracket glyphs.
    await page.getByLabel(/search parts/i).press("Enter");
    await expect(page).toHaveURL(/\/marketplace\/brakes-suspension\/coilovers\?q=coil/);

    // Phones: the grid retires, the Browse sheet carries the whole taxonomy.
    await page.setViewportSize(VIEWPORTS.phone);
    await page.goto("/marketplace");
    // Two grids are in the DOM now — the page's and the Browse sheet's own
    // copy, which is rendered closed rather than mounted on open. What the
    // rule is about is that neither is *shown* at this width.
    const grids = page.locator(".catgrid");
    for (let i = 0; i < (await grids.count()); i++) {
      await expect(grids.nth(i)).toBeHidden();
    }
    const browse = page.getByRole("button", { name: /browse categories/i });
    await expect(browse).toBeVisible();
    expect((await browse.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await browse.click();
    const sheet = page.getByRole("dialog", { name: /browse by category/i });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: /wheels & tires/i })).toBeVisible();
    await sheet.getByRole("link", { name: /wheels & tires/i }).click();
    await expect(page).toHaveURL(/\/marketplace\/wheels-tires$/);
    // …and on a category page the sheet unfolds that category's subcategories.
    await page.getByRole("button", { name: /browse categories/i }).click();
    await expect(
      page.getByRole("dialog", { name: /browse by category/i }).getByRole("link", { name: /spacers & hardware/i })
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  // ---------- quick commerce ----------

  for (const tier of PHONE_TIERS) {
    test(`marketplace cards: separate Save, no nested interactives @ ${VIEWPORTS[tier].width}`, async ({
      page,
    }) => {
      await page.context().clearCookies();
      await page.setViewportSize(VIEWPORTS[tier]);
      await page.goto(`/marketplace?q=${encodeURIComponent(partTitle)}`);
      await assertNoNestedInteractives(page, `/marketplace @ ${VIEWPORTS[tier].width}`);
      const card = page.locator("article.marketplace-card").first();
      await expect(card).toBeVisible();
      // M-5 (2026-09): add-to-cart belongs on the card — it is for the part
      // you already recognised. Buy now does not: deciding to buy happens on
      // the item page.
      await expect(card.getByRole("button", { name: /^buy now|^like/i })).toHaveCount(0);
      const cart = card.getByRole("button", { name: /add to cart/i });
      await expect(cart).toBeVisible();
      expect((await cart.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const save = card.getByRole("button", { name: /^save /i });
      await expect(save).toBeVisible();
      expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      // The card's own link is a real, large target beneath the photo.
      const link = card.locator("a.marketplace-card__link");
      expect((await link.boundingBox())!.height).toBeGreaterThan(120);
    });
  }

  test("guest: opening a shopping card preserves context and Buy now continues to cart", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`/marketplace?q=${encodeURIComponent(partTitle)}`);
    await page.locator("article.marketplace-card a.marketplace-card__link").first().click();
    await expect(page).toHaveURL(/\/listings\/[^?]+\?from=/);
    expect(new URL(page.url()).searchParams.get("from")).toContain("/marketplace?q=");
    await page.getByRole("button", { name: /buy now/i }).first().click();
    await expect(page).toHaveURL(/\/cart\?buynow=1/);
    await expect(page.getByText(partTitle).first()).toBeVisible();
  });

  test("own listing: the seller sees no purchase controls on their own card", async ({ page }) => {
    await signIn(page, seller);
    await page.goto(`/marketplace?q=${encodeURIComponent(partTitle)}`);
    const card = page.locator("article.marketplace-card").first();
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: /buy now/i })).toHaveCount(0);
    await expect(card.getByRole("button", { name: /add to cart/i })).toHaveCount(0);
    await card.locator("a.marketplace-card__link").click();
    await expect(page.getByRole("button", { name: /buy now|add to cart/i })).toHaveCount(0);
  });

  test("Explore cards stay discovery-only and name their icons on focus", async ({ page }) => {
    await page.context().clearCookies();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/explore");
    await assertNoNestedInteractives(page, "/explore");
    await expect(page.getByRole("button", { name: /buy now/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /add to cart/i })).toHaveCount(0);

    const like = page.locator(".cardeng__act[data-tip]").first();
    await expect(like).toBeVisible();
    await like.focus();
    // The tooltip is the ::after of the focused control — visible (opacity 1)
    // only while focused, and it adds no height to the card.
    const before = await like.evaluate((el) => el.closest(".mcell")!.getBoundingClientRect().height);
    const shown = await like.evaluate((el) => getComputedStyle(el, "::after").opacity);
    expect(shown).toBe("1");
    const after = await like.evaluate((el) => el.closest(".mcell")!.getBoundingClientRect().height);
    expect(after).toBe(before);
    await expect(like).toHaveAttribute("aria-label", /like/i);
  });

  test.afterAll(async () => {
    await cleanupE2eUsers();
  });
});
