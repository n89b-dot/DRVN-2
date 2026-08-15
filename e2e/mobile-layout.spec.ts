import { expect, test } from "@playwright/test";

import {
  addCar,
  cleanupE2eUsers,
  enableSellerPayouts,
  makeUser,
  publishListing,
  signIn,
  signUp,
} from "./helpers";

/**
 * Targeted phone-layout assertions (375x812) for the remediated surfaces:
 * the listing detail purchase order + sticky buybar, the Home/Garage vehicle
 * presentation, marketplace filter chips and the Explore grid. Data is
 * created through the real signup/garage/sell flows, golden-path style.
 */

const stamp = Date.now();
const seller = makeUser("ml-seller", stamp);
const buyer = makeUser("ml-buyer", stamp);
const carName = `E2E ML Car ${stamp}`;
const partTitle = `E2E ML Intake ${stamp}`;

let listingPath = "";

test.describe.serial("mobile layout @ 375x812", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("setup: seller signs up, adds a car, lists a part", async ({ page }) => {
    await signUp(page, seller);
    await enableSellerPayouts(seller.username);
    await addCar(page, carName);
    listingPath = await publishListing(page, {
      title: partTitle,
      price: "150",
      shipping: "15",
      sourceCarLabel: `Off my sheet — ${carName}`,
    });
  });

  test("listing detail: rail precedes content, buybar behaves", async ({ page }) => {
    // A second user views it, so purchase actions render (not the owner view).
    await signUp(page, buyer);
    await page.goto(listingPath);
    await expect(page.getByRole("heading", { name: partTitle })).toBeVisible();

    const rail = page.locator(".pdp__rail");
    const content = page.locator(".pdp__content");
    await expect(rail).toBeVisible();
    await expect(content).toBeVisible();

    // DOM order: purchase rail before the long-form content.
    const railBeforeContent = await page.evaluate(() => {
      const r = document.querySelector(".pdp__rail");
      const c = document.querySelector(".pdp__content");
      if (!r || !c) return false;
      return Boolean(r.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(railBeforeContent, ".pdp__rail must precede .pdp__content in the DOM").toBe(true);

    // Visual order on a phone: the rail sits above the description.
    const railBox = await rail.boundingBox();
    const contentBox = await content.boundingBox();
    expect(railBox, "rail bounding box").toBeTruthy();
    expect(contentBox, "content bounding box").toBeTruthy();
    expect(railBox!.y).toBeLessThan(contentBox!.y);

    // Scroll the real purchase actions off screen — the sticky buybar shows.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const buybar = page.locator(".buybar");
    await expect(buybar).toBeVisible();
    await expect(buybar).not.toHaveAttribute("data-hidden", "true");

    // Its Buy now is a real tap target.
    const buyNow = buybar.getByRole("button", { name: /buy now/i });
    await expect(buyNow).toBeVisible();
    const buyBox = await buyNow.boundingBox();
    expect(buyBox!.height).toBeGreaterThanOrEqual(44);

    // The bar must not obscure the page's last content: with the page fully
    // scrolled, the Foot clears the buybar (body padding accounts for it).
    const { footBottom, barTop } = await page.evaluate(() => {
      const foot = document.querySelector("footer.foot")!.getBoundingClientRect();
      const bar = document.querySelector(".buybar")!.getBoundingClientRect();
      return { footBottom: foot.bottom, barTop: bar.top };
    });
    expect(footBottom, "Foot must clear the sticky buybar").toBeLessThanOrEqual(barTop + 1);
  });

  test("home: garage row uses vehicle presentation, not an order thumb", async ({ page }) => {
    await signIn(page, seller);
    await page.goto("/home");
    const img = page.locator(".vehicle--row .vehicle__img").first();
    await expect(img).toBeVisible();
    const box = await img.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(104);
  });

  test("garage: card image is generous and Manage is present", async ({ page }) => {
    await signIn(page, seller);
    await page.goto("/garage");
    const card = page.locator(".vehicle--card").first();
    await expect(card).toBeVisible();
    const box = await card.locator(".vehicle__img").boundingBox();
    // Single-column stacked below 640px — the image runs the card's width.
    expect(box!.width).toBeGreaterThanOrEqual(300);
    await expect(card.getByRole("link", { name: /manage/i })).toBeVisible();
  });

  test("marketplace: filter chips only when filters are applied", async ({ page }) => {
    await page.goto("/marketplace?condition=used&min=10");
    const chipsGroup = page.locator(".filterchips");
    await expect(chipsGroup).toBeVisible();
    await expect(chipsGroup.getByRole("link", { name: /clear all/i })).toBeVisible();

    const chips = chipsGroup.locator(".chip--x");
    const count = await chips.count();
    expect(count).toBeGreaterThanOrEqual(2); // condition + price
    for (let i = 0; i < count; i++) {
      const box = await chips.nth(i).boundingBox();
      expect(box!.height, `chip ${i} tap height`).toBeGreaterThanOrEqual(32);
    }

    await page.goto("/marketplace");
    await expect(page.locator(".filterchips")).toHaveCount(0);
  });

  test("explore: packed masonry columns, single column on phones", async ({ page }) => {
    // Design decision (revised per review): the feed is column-packed masonry
    // (.feedcols — the Read.cv/Cosmos pattern). Chronological DOM order,
    // natural card heights, one column at phone width.
    await page.goto("/explore");
    const feed = page.locator(".feedcols").first();
    await expect(feed, "explore feed (needs at least one feed item)").toBeVisible();
    const style = await feed.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { columnCount: cs.columnCount };
    });
    expect(Number(style.columnCount)).toBe(1);
  });
});

test.afterAll(async () => {
  await cleanupE2eUsers();
});
