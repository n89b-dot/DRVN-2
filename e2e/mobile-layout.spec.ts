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
    // The canonical .vehicle--row pattern gives the plate a 96px column at
    // compact widths (037895c) — still a vehicle plate, not a ~56px order
    // thumb, which is what this guard exists to catch.
    expect(box!.width).toBeGreaterThanOrEqual(96);
  });

  test("garage: build sheet — full-width plate, folded details, three-tool rail", async ({ page }) => {
    await signIn(page, seller);
    await page.goto("/garage");
    const sheet = page.locator(".gsheet").first();
    await expect(sheet).toBeVisible();
    // On phones the cover plate runs the sheet's full inner width above the
    // identity — the car leads, then what's measured about it.
    const plate = await sheet.locator(".gsheet__plate").boundingBox();
    const sheetBox = await sheet.boundingBox();
    expect(plate!.width).toBeGreaterThanOrEqual(sheetBox!.width - 40);
    // The measured half is folded behind a digest on phones; the tool rail
    // stays visible regardless, three equal 44px tools.
    const toggle = sheet.getByRole("button", { expanded: false });
    await expect(toggle).toBeVisible();
    await expect(sheet.locator(".gsheet__dims")).toBeHidden();
    const rail = sheet.locator(".gsheet__rail a");
    await expect(rail).toHaveCount(3);
    for (const tool of await rail.all()) {
      await expect(tool).toBeVisible();
      const box = await tool.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    // Unfold: four dimensions (Earned retired 22 Aug 2026), each label on one line.
    await toggle.click();
    const dims = sheet.locator(".gsheet__dims .livedim");
    await expect(dims).toHaveCount(4);
    for (const label of await dims.locator(".microlabel").all()) {
      const box = await label.boundingBox();
      expect(box!.height).toBeLessThanOrEqual(18);
    }
    // The car's name is the way to its build page.
    await sheet.locator(".gsheet__namelink").click();
    await expect(page).toHaveURL(/\/cars\/[\w-]+/);
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

  test("explore: mosaic wall, two columns on phones", async ({ page }) => {
    // Design decision (revised 22 Aug 2026): the feed is a dense photo
    // mosaic (.mosaic — Best Buy customer-images pattern). Kinds are
    // interleaved across the page, two columns at phone width, 2-wide and
    // 2×2 cells only on phones.
    await page.goto("/explore");
    const wall = page.locator(".mosaic").first();
    await expect(wall, "explore wall (needs at least one feed item)").toBeVisible();
    const cols = await wall.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length
    );
    expect(cols).toBe(2);
  });
});

test.afterAll(async () => {
  await cleanupE2eUsers();
});
