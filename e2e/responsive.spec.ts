import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

/**
 * Responsive regression floor for the anonymous surfaces: no horizontal
 * overflow at any supported viewport, plus visual baselines with animations
 * frozen and volatile regions (network images, live listing/feed content)
 * masked so the baselines stay deterministic across data changes.
 */

// Visual baselines need the same conditional sections on an empty test DB.
// This fixture is scoped to this suite and never uses the shared application env.
const visualId = randomUUID();
let visualUserId: string | undefined;
const visualAdmin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
test.beforeAll(async () => {
  const admin = visualAdmin();
  const user = await admin.auth.admin.createUser({ email: `e2e-visual-${visualId}@drvn.test`, email_confirm: true });
  if (user.error || !user.data.user) throw user.error || new Error("Visual fixture user missing");
  visualUserId = user.data.user.id;
  const path = `${visualUserId}/visual.png`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9kAAAAASUVORK5CYII=", "base64");
  const upload = await admin.storage.from("car-images").upload(path, png, { contentType: "image/png" });
  if (upload.error) throw upload.error;
  const cover = admin.storage.from("car-images").getPublicUrl(path).data.publicUrl;
  const car = await admin.from("cars").insert({ owner_id: visualUserId, slug: `visual-${visualId}`, name: "Visual fixture build", is_public: true, cover_image_url: cover });
  if (car.error) throw car.error;
  const listing = await admin.from("listings").insert({ seller_id: visualUserId, title: "Visual fixture part", category: "performance", price_cents: 10000, shipping_cents: 0, currency: "GBP", status: "active" });
  if (listing.error) throw listing.error;
});
test.afterAll(async () => {
  if (!visualUserId) return;
  const admin = visualAdmin();
  const removed = await admin.storage.from("car-images").remove([`${visualUserId}/visual.png`]);
  if (removed.error) throw removed.error;
  const deleted = await admin.auth.admin.deleteUser(visualUserId);
  if (deleted.error) throw deleted.error;
});

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
      // The masked inventory region must extend beyond the viewport regardless
      // of how many synthetic listings another suite retained for its ledger.

      // The auth pages' live-listing backdrop is data-driven decoration
      // (inert, scrimmed); left visible, its .mkt grid would be masked
      // magenta across the page center — swallowing the auth card the
      // screenshot exists to test.
      ".authstage { display: none !important; }",
    ].join("\n"),
  });
  // The landing hero is the newest public car's cover photo, so whether it
  // exists at all — and how far it pushes the page down — depends on what
  // other suites left behind. Hidden like the auth backdrop (direct style:
  // see the CSP note below). That means neither the baselines nor the
  // overflow checks here (the 320 smoke included) see the hero's geometry:
  // e2e/landing-hero.spec.ts covers it on the unmodified page, with the hero
  // visible, at 320–1440 in both themes, with and without reduced motion,
  // with a failed photo, with long content, and by keyboard.
  await page.locator(".landing-hero").evaluateAll(elements => elements.forEach(element => { (element as HTMLElement).style.display = "none"; }));
  if (path === "/marketplace") {
    // Direct style properties work under the enforced nonce CSP; an unnonced
    // injected stylesheet is correctly blocked by the browser.
    await page.locator("main section.deck").evaluateAll(elements => elements.forEach(element => { (element as HTMLElement).style.minHeight = "100vh"; }));
  }
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
            // The sidebar's category list carries live counts (M-3).
            ...(route === "/marketplace" ? [page.locator("main section.deck"), page.locator(".catside__n")] : []),
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
