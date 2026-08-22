import { test, type Page } from "@playwright/test";

import {
  addCar,
  cleanupE2eUsers,
  enableSellerPayouts,
  makeUser,
  publishListing,
  signUp,
} from "./helpers";
import { VIEWPORTS } from "./viewports";

/**
 * Evidence capture for the mobile remediation review — full-page screenshots
 * of the remediated compositions at the matrix viewports, written to
 * screenshots/mobile-remediation/. Not a regression suite: runs only when
 * EVIDENCE=1 so normal `playwright test` stays behavioral.
 */

test.describe.serial("remediation evidence capture", () => {
  test.skip(process.env.EVIDENCE !== "1", "evidence capture runs only with EVIDENCE=1");
  test.use({ viewport: VIEWPORTS.phone });

  const stamp = Date.now();
  const seller = makeUser("ev-seller", stamp);
  const dir = "screenshots/mobile-remediation";

  async function settle(page: Page) {
    await page.addStyleTag({
      content:
        "*,*::before,*::after{transition:none!important;animation:none!important}.rv{opacity:1!important;transform:none!important}",
    });
    await page.waitForLoadState("networkidle");
  }

  test("capture", async ({ page }) => {
    test.setTimeout(300_000);

    // Guest surfaces.
    await page.goto("/marketplace");
    await settle(page);
    await page.screenshot({ path: `${dir}/marketplace-390.png` });

    const card = page.locator('.mosaic a[href^="/listings/"]').first();
    if (await card.count()) {
      await card.click();
      await page.locator(".pdp__rail .num-giant").waitFor();
      await settle(page);
      await page.screenshot({ path: `${dir}/pdp-390.png`, fullPage: false });
    }

    await page.setViewportSize(VIEWPORTS.compactShort);
    await page.goto("/marketplace");
    await settle(page);
    await page.screenshot({ path: `${dir}/marketplace-320x568.png` });

    // Seller persona.
    await page.setViewportSize(VIEWPORTS.phone);
    await signUp(page, seller);
    await enableSellerPayouts(seller.username);
    for (const name of [`Evidence GT ${stamp}`, `Evidence Wagon ${stamp}`, `Evidence Track ${stamp}`])
      await addCar(page, name);
    await publishListing(page, {
      title: `Evidence part ${stamp}`,
      price: "120",
      shipping: "10",
      sourceCarLabel: `Off my sheet — Evidence GT ${stamp}`,
    });

    await page.goto("/garage");
    await settle(page);
    await page.screenshot({ path: `${dir}/garage-390.png` });

    await page.goto("/home");
    await settle(page);
    await page.screenshot({ path: `${dir}/home-390.png` });

    await cleanupE2eUsers();
  });
});
