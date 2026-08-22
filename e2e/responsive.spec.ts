import { expect, test, type Page } from "@playwright/test";

/**
 * Responsive regression floor for the anonymous surfaces: no horizontal
 * overflow at any supported viewport, plus visual baselines with animations
 * frozen and volatile regions (network images, live listing/feed content)
 * masked so the baselines stay deterministic across data changes.
 */

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

const ROUTES = ["/", "/marketplace", "/login", "/signup", "/protection"] as const;

function slug(route: string) {
  return route === "/" ? "landing" : route.replace(/^\//, "").replace(/\//g, "-");
}

/** Freeze motion and dev-mode chrome before measuring or screenshotting. */
async function settle(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({
    content: [
      "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }",
      // Next dev-tools overlay is not the product.
      "nextjs-portal { display: none !important; }",
      // The auth pages' live-listing backdrop is data-driven decoration
      // (inert, scrimmed); left visible, its .mkt grid would be masked
      // magenta across the page center — swallowing the auth card the
      // screenshot exists to test.
      ".authstage { display: none !important; }",
    ].join("\n"),
  });
  await page.evaluate(() => document.fonts.ready);
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `horizontal overflow on ${label}`).toBeLessThanOrEqual(clientWidth + 1);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, colorScheme: "dark" });

    for (const route of ROUTES) {
      test(`${route} fits and matches baseline`, async ({ page }) => {
        await settle(page, route);
        await assertNoHorizontalOverflow(page, `${route} @ ${vp.width}x${vp.height}`);

        await expect(page).toHaveScreenshot(`${slug(route)}-${vp.width}x${vp.height}.png`, {
          animations: "disabled",
          // Data-driven regions vary run to run (listings, feed tiles, remote
          // images) — mask them; the layout around them is what's under test.
          mask: [
            page.locator("img"),
            page.locator(".tile__img"),
            page.locator(".tile"),
            page.locator(".mkt"),
            page.locator(".mosaic"),
          ],
          maxDiffPixelRatio: 0.02,
        });
      });
    }
  });
}

// Smallest supported width: overflow smoke only — no baselines at 320.
test.describe("320x700 smoke", () => {
  test.use({ viewport: { width: 320, height: 700 } });

  for (const route of ROUTES) {
    test(`${route} has no horizontal overflow at 320`, async ({ page }) => {
      await settle(page, route);
      await assertNoHorizontalOverflow(page, `${route} @ 320x700`);
    });
  }
});
