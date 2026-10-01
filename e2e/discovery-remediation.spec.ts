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
    // From 1081px the rail lists the same children and the plate stands down
    // (11-responsive.css, selling-nav.tsx), so read the plate below that.
    await page.setViewportSize(VIEWPORTS.tabletPortrait);
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

  // ---------- Home tabs (H-1) ----------

  test("Home is one feed with URL-addressable tabs, and says nothing twice", async ({ page }) => {
    await signIn(page, seller);
    await page.goto("/home");

    const tabs = page.getByRole("group", { name: /which feed to show/i });
    await expect(tabs).toBeVisible();
    // Local only exists once a member has said where they are.
    await expect(tabs.getByRole("link")).toHaveText(["Following", "For you"]);

    await tabs.getByRole("link", { name: "For you" }).click();
    await expect(
      page.getByRole("group", { name: /which feed to show/i }).getByRole("link", { name: "For you" })
    ).toHaveAttribute("aria-current", "true");
    // Cards, rows, or the tab's own named empty state — never a blank column.
    // (Home's lead feed renders FeedList as cards; an empty database shows
    // the empty state, which is why this only failed on a populated stack.)
    await expect(page.locator(".deck--main__feed--lead").locator(".feedcards, .rowlist, .undrawn").first()).toBeVisible();

    // An unknown tab is the default, not an empty page.
    await page.goto("/home?tab=for-sale");
    await expect(page.getByRole("group", { name: /which feed to show/i })).toBeVisible();

    // The new layout REPLACED the old one: one garage tile, and no Buy now
    // anywhere on Home (a ruling — buying is decided on the part's page).
    await expect(page.getByText("Your garage", { exact: true })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /buy now/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /buy now/i })).toHaveCount(0);

    // Phones: nothing scrolls sideways once the rail folds into the feed.
    await page.setViewportSize(VIEWPORTS.compactShort);
    await page.goto("/home");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "Home must not scroll sideways at 320px").toBeLessThanOrEqual(0);
  });

  // ---------- category navigation ----------

  test("categories are destinations: a sidebar list on desktop, a Browse sheet on phones", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/marketplace");

    // M-3: from 1024px categories live in the left column with the filters.
    // The tiles still exist for narrower widths; here they are not shown.
    const side = page.locator(".catside");
    await expect(side).toBeVisible();
    await expect(side.getByRole("link", { name: /all parts/i })).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".catgrid").first()).toBeHidden();
    await side.getByRole("link", { name: /brakes & suspension/i }).click();
    await expect(page).toHaveURL(/\/marketplace\/brakes-suspension$/);
    // The current category opens to its part types, in place.
    await page.locator(".catside").getByRole("link", { name: /coilovers/i }).click();
    await expect(page).toHaveURL(/\/marketplace\/brakes-suspension\/coilovers$/);
    // Leaf: the list is still there, with the leaf marked as where you are.
    await expect(page.locator(".catside").getByRole("link", { name: /coilovers/i })).toHaveAttribute(
      "aria-current",
      "page"
    );
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
    // No checkout CTA on the wall: the only cart control is the compact
    // square in a part card's engagement strip (c2a332b, bcc7bd5).
    const cartControls = page.getByRole("button", { name: /add to cart/i });
    await expect(cartControls).toHaveCount(await page.locator(".cardeng .cartbtn").count());

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
