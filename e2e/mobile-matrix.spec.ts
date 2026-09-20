import { createDiscoveryFixture } from "./fixtures";
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
 * The production mobile verification matrix (SYS-01).
 *
 * Behavioral contracts at the three named phone tiers — 320×568, 390×844,
 * 430×932 — covering the systemic remediations: compact task heads
 * (SYS-02), the marketplace discovery hierarchy (SYS-03), garage
 * management rows (SYS-04), the PDP transaction order (SYS-09), the Home
 * attention stack (SYS-10), offer decision placement, and — when the
 * server settles payments inline (stub mode) — order rows and the pinned
 * thread composer (SYS-08).
 *
 * Payments-mode adaptive: against a Stripe(test) server the purchase stops
 * at the payment step, which is exactly where the checkout review contract
 * (SYS-11) lives; against a stub server the same flow completes and the
 * order/message contracts run instead. Both paths are asserted; neither is
 * silently skipped.
 */

let discovery: Awaited<ReturnType<typeof createDiscoveryFixture>>;
test.beforeAll(async () => { discovery = await createDiscoveryFixture(); });
test.afterAll(async () => { await discovery?.cleanup(); });

const stamp = Date.now();
const seller = makeUser("mx-seller", stamp);
const buyer = makeUser("mx-buyer", stamp);
const carNames = [1, 2, 3].map((n) => `E2E MX Car ${n} ${stamp}`);
const partA = `E2E MX Brake Master ${stamp}`;
const partB = `E2E MX Coilover Set ${stamp}`;

let listingA = "";
let listingB = "";

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, "page must not scroll horizontally").toBeLessThanOrEqual(1);
}

/** SYS-02 acceptance: the head has spent its runway inside 45% of the viewport. */
async function assertHeadBudget(page: Page, height: number) {
  const h1 = page.locator(".pagehead h1").first();
  await expect(h1).toBeVisible();
  const box = await h1.boundingBox();
  expect(box!.y + box!.height, "task h1 must end within 45% of the viewport").toBeLessThan(
    height * 0.45
  );
}

// ---------------------------------------------------------------------------
// Guest discovery contracts, per phone tier
// ---------------------------------------------------------------------------

for (const tier of PHONE_TIERS) {
  const vp = VIEWPORTS[tier];

  test.describe(`guest discovery @ ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test("marketplace: compact controls, then inventory", async ({ page }) => {
      await page.goto("/marketplace");
      await assertNoHorizontalOverflow(page);

      // Discovery controls: search, Refine, Sort — all present, all on the
      // compact toolbar, all real touch targets.
      const search = page.getByLabel(/search parts/i);
      await expect(search).toBeVisible();
      const refine = page.getByRole("button", { name: /filters/i });
      await expect(refine).toBeVisible();
      expect((await refine.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(page.locator('select[name="sort"]')).toBeVisible();

      // The desktop sort chips stay retired on compact — one sort control.
      await expect(page.locator('div[role="group"][aria-label="Sort results"]')).toBeHidden();

      // Inventory beats chrome: the first listing card starts inside the
      // first viewport at the 390/430 tiers (SYS-03 acceptance), and within
      // 1.5 viewports even at 320×568.
      const firstCard = page.locator(".mosaic .mcell").first();
      if (await firstCard.count()) {
        const box = await firstCard.boundingBox();
        const budget = tier === "compactShort" ? vp.height * 1.5 : vp.height;
        expect(box!.y, "first listing must begin within the viewport budget").toBeLessThan(budget);
      }
    });

    test("marketplace: refine sheet discards a cancelled draft and restores focus", async ({ page }) => {
      await page.goto("/marketplace");
      const refine = page.getByRole("button", { name: /filters/i });
      await refine.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(/location/i).fill("Portland");
      await page.keyboard.press("Escape");
      await expect(refine).toBeFocused();
      // Closing without Apply is Cancel, and Cancel discards the draft
      // (2026-09-13: a filter you backed out of must not ride along with
      // the next search). Applied values are what survive — see
      // marketplace-browsing's "Cancel discards draft filters".
      await refine.click();
      await expect(dialog.getByLabel(/location/i)).toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(refine).toBeFocused();
    });

    test("listing detail: price and actions precede record metadata", async ({ page }) => {
      await page.goto(discovery.listingPath);
      await expect(page).toHaveURL(/\/listings\/[\w-]+/);
      await assertNoHorizontalOverflow(page);

      // Wait out the route's loading skeleton first — evaluate() doesn't
      // auto-wait the way locators do.
      await page.locator(".pdp__rail .num-giant").waitFor();

      // One atomic measurement pass — sequential boundingBox() reads flaked
      // when an image settled (or failed) between reads and shifted layout.
      const order = await page.evaluate(() => {
        const rail = document.querySelector(".pdp__rail");
        if (!rail) return null;
        const y = (el: Element | null | undefined) =>
          el ? el.getBoundingClientRect().top + window.scrollY : null;
        const buttons = [...rail.querySelectorAll("button")];
        const buy = buttons.find((b) => /buy now/i.test(b.textContent ?? ""));
        const watching = [...rail.querySelectorAll("*")].find(
          (el) => el.children.length === 0 && /^watching$/i.test((el.textContent ?? "").trim())
        );
        const dispatch = [...rail.querySelectorAll(".spec-note")].find((el) =>
          /expected to dispatch/i.test(el.textContent ?? "")
        );
        return {
          price: y(rail.querySelector(".num-giant")),
          buy: y(buy),
          buyHeight: buy ? buy.getBoundingClientRect().height : null,
          watching: y(watching),
          dispatch: y(dispatch),
        };
      });

      // SYS-09: price → actions → (seller) → record. No secondary metric
      // may sit between the price and the primary action.
      expect(order).not.toBeNull();
      expect(order!.buyHeight!).toBeGreaterThanOrEqual(44);
      expect(order!.price!).toBeLessThan(order!.buy!);
      expect(order!.buy!).toBeLessThan(order!.watching!);
      expect(order!.buy!).toBeLessThan(order!.dispatch!);

      // The sticky buybar takes over once the in-rail actions scroll out of
      // view, and the page reserves clearance for it.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const buybar = page.locator(".buybar");
      await expect(buybar).toBeVisible();
      await expect(buybar).not.toHaveAttribute("data-hidden", "true");
      const bodyPad = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.body).paddingBottom)
      );
      expect(bodyPad).toBeGreaterThanOrEqual(76);
    });
  });
}

// ---------------------------------------------------------------------------
// Documented-transition probes (SYS-05) — resize sweep, one page load each
// ---------------------------------------------------------------------------

test.describe("anatomy transitions land on documented thresholds", () => {
  test("PDP buybar retires exactly at the 981px split", async ({ page }) => {
    await page.goto(discovery.listingPath);
    await expect(page).toHaveURL(/\/listings\/[\w-]+/);

    for (const width of [979, 980]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator(".buybar")).toBeAttached();
      expect(
        await page.locator(".buybar").evaluate((el) => getComputedStyle(el).display)
      ).not.toBe("none");
    }
    await page.setViewportSize({ width: 981, height: 900 });
    expect(await page.locator(".buybar").evaluate((el) => getComputedStyle(el).display)).toBe(
      "none"
    );
  });

  test("register rail exists only above 1080px", async ({ page }) => {
    // Signed-out shells never show the rail; this probes the compact bar's
    // index trigger instead, which must exist ≤1080 and go ≥1081.
    await page.goto("/marketplace");
    await page.setViewportSize({ width: 1080, height: 900 });
    await expect(page.locator(".indexbtn")).toBeVisible();
    await page.setViewportSize({ width: 1081, height: 900 });
    await expect(page.locator(".indexbtn")).toBeHidden();
    for (const width of [639, 640, 641]) {
      await page.setViewportSize({ width, height: 900 });
      await assertNoHorizontalOverflow(page);
    }
  });
});

// ---------------------------------------------------------------------------
// Authenticated story @ 390×844 — seller with three cars, buyer with intent
// ---------------------------------------------------------------------------

test.describe.serial("authenticated matrix @ 390x844", () => {
  test.use({ viewport: VIEWPORTS.phone });

  test.afterAll(async () => {
    await cleanupE2eUsers();
  });

  test("setup: seller with three cars and two listings", async ({ page }) => {
    test.setTimeout(180_000);
    await signUp(page, seller);
    await enableSellerPayouts(seller.username);
    for (const name of carNames) await addCar(page, name);
    listingA = await publishListing(page, {
      title: partA,
      price: "180",
      shipping: "12",
      sourceCarLabel: `Off my sheet — ${carNames[0]}`,
    });
    listingB = await publishListing(page, {
      title: partB,
      price: "420",
      shipping: "25",
      sourceCarLabel: `Off my sheet — ${carNames[0]}`,
    });
    expect(listingA).toMatch(/^\/listings\//);
    expect(listingB).toMatch(/^\/listings\//);
  });

  test("task heads: h1 lands within 45% of the viewport on every task route", async ({
    page,
  }) => {
    await signIn(page, seller);
    for (const route of [
      "/home",
      "/marketplace",
      "/garage",
      "/listings",
      "/offers",
      "/orders",
      "/messages",
      "/notifications",
      "/saved",
      "/payouts",
    ]) {
      await page.goto(route);
      await assertHeadBudget(page, VIEWPORTS.phone.height);
      await assertNoHorizontalOverflow(page);
    }
  });

  // The garage rebuild (Aug 2026) replaced dense management rows with build
  // sheets, folded on phones. SYS-04's intent — every car manageable, tools
  // reachable without hunting — now means: all three sheets render, and the
  // first sheet's full three-tool rail (44px targets) sits inside the first
  // viewport. The sheet anatomy itself is covered in mobile-layout.spec.
  test("garage: first sheet's management rail inside the first viewport", async ({ page }) => {
    await signIn(page, seller);
    await page.goto("/garage");
    const sheets = page.locator(".gsheet");
    await expect(sheets).toHaveCount(3);

    const rail = sheets.first().locator(".gsheet__rail a");
    await expect(rail).toHaveCount(3);
    for (const tool of await rail.all()) {
      await expect(tool).toBeVisible();
      const box = await tool.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(
        box!.y + box!.height,
        "first sheet's tools must fit the first viewport"
      ).toBeLessThan(VIEWPORTS.phone.height);
    }
  });

  test("buyer: offer lands; seller sees who acts next everywhere", async ({ page }) => {
    test.setTimeout(120_000);
    await signUp(page, buyer);
    await page.goto(listingB);
    await page.getByRole("button", { name: /make an offer/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/your offer/i).fill("350");
    await dialog.getByRole("button", { name: /send offer/i }).click();
    await expect(page.getByText(/offer sent/i).first()).toBeVisible({ timeout: 30_000 });

    // Switch personas: drop the buyer session first — /login redirects a
    // signed-in visitor straight back to /home.
    await page.context().clearCookies();

    // Seller: the attention stack lives on Selling now (H-6) — Home is the
    // feed and what's around it; a seller's to-dos are where they went to work.
    await signIn(page, seller);
    await page.goto("/selling");
    const needsYou = page.locator("main").getByText(/needs you/i).first();
    await expect(needsYou).toBeVisible();
    const offerRow = page.locator("main").getByRole("link", { name: /offer/i }).first();
    await expect(offerRow).toBeVisible();
    expect((await offerRow.boundingBox())!.y).toBeLessThan(VIEWPORTS.phone.height);

    // …the offers index flags the row…
    await page.goto("/offers");
    await expect(page.locator("main").getByText(/needs you/i).first()).toBeVisible();

    // …and the thread leads with the decision, above the conversation.
    await page.locator('a[href^="/offers/"]', { hasText: partB }).first().click();
    await expect(page).toHaveURL(/\/offers\/[\w-]+/);
    const accept = page.getByRole("button", { name: /accept \$/i }).first();
    await expect(accept).toBeVisible();
    const composerInput = page.getByPlaceholder(/message/i).first();
    const acceptBox = await accept.boundingBox();
    const composerBox = await composerInput.boundingBox();
    expect(acceptBox!.y, "decision actions must precede the composer").toBeLessThan(
      composerBox!.y
    );
    await assertNoHorizontalOverflow(page);
  });

  test("checkout: one Delivery & contact edit, one cart edit — or stub completes", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, buyer);
    await page.goto(listingA);
    await page.getByRole("button", { name: /add to cart/i }).click();
    await expect(page.getByText(/added to cart/i).first()).toBeVisible();
    await page.goto("/cart");
    await page.getByRole("link", { name: /proceed to checkout/i }).first().click();
    await expect(page).toHaveURL(/\/checkout/);
    await assertNoHorizontalOverflow(page);

    await page.getByLabel(/^name/i).fill("E2E MX Buyer");
    await page.getByLabel(/^address$/i).fill("1 Matrix Street");
    await page.getByLabel(/city/i).fill("Testville");
    await page.getByLabel(/postcode/i).fill("TE5 7MX");
    await page.getByLabel(/country/i).selectOption({ label: "United Kingdom" });
    await page.getByRole("button", { name: /continue to payment|confirm and pay/i }).click();

    // Stripe(test) stops at the payment step — the SYS-11 review; stub
    // settles inline and lands on the order.
    const outcome = await Promise.race([
      page
        .waitForURL(/\/orders/, { timeout: 30_000 })
        .then(() => "order" as const)
        .catch(() => null),
      page
        .getByText(/delivery & contact/i)
        .waitFor({ timeout: 30_000 })
        .then(() => "review" as const)
        .catch(() => null),
    ]);

    if (outcome === "review") {
      // Exactly one edit affordance per conceptual block (SYS-11).
      await expect(page.getByRole("button", { name: /^edit$/i })).toHaveCount(1);
      await expect(page.getByRole("link", { name: /edit cart/i })).toHaveCount(1);
      // Editing returns with every field retained.
      await page.getByRole("button", { name: /^edit$/i }).click();
      await expect(page.getByLabel(/^address$/i)).toHaveValue("1 Matrix Street");
      await expect(page.getByLabel(/postcode/i)).toHaveValue("TE5 7MX");
    } else if (outcome === "order") {
      // Stub path: the order exists — orders triage leads with next action
      // and the thread composer is conversation-native (SYS-08).
      await page.goto("/orders");
      const row = page.locator('a[href^="/orders/"]').first();
      await expect(row.locator(".ordernext")).toBeVisible();

      await row.click();
      await page.waitForURL(/\/orders\/[\w-]+/);
      const orderId = new URL(page.url()).pathname.split("/")[2];
      await page.goto(`/messages/${orderId}`);
      const composer = page.locator(".composer--pin");
      await expect(composer).toBeVisible();
      expect(await composer.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
      const input = composer.getByPlaceholder(/message the other party/i);
      expect(
        await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      ).toBeGreaterThanOrEqual(16);
      await input.fill("Matrix check — does this fit the MX car?");
      await composer.getByRole("button", { name: /send/i }).click();
      // Server action + router.refresh on a cold production route can take a
      // while — the default 10s flaked.
      await expect(page.getByText(/does this fit the MX car/i).first()).toBeVisible({
        timeout: 30_000,
      });

      // History mode retires the composer and offers the way back.
      await page.goto(`/messages/${orderId}?before=${encodeURIComponent(new Date().toISOString())}`);
      await expect(page.locator(".composer--pin")).toHaveCount(0);
      await expect(page.getByRole("link", { name: /back to latest to reply/i })).toBeVisible();
    } else {
      throw new Error("checkout reached neither the payment review nor an order");
    }
  });

  test("seller can fully delete a listing from the ledger", async ({ page }) => {
    await signIn(page, seller);
    await page.goto("/listings");
    const row = page.locator("tr", { hasText: partB }).first();
    await row.getByRole("button", { name: /delete/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /delete permanently/i }).click();

    // Lands back on the ledger with the confirmation, and the row is gone.
    await page.waitForURL(/\/listings\?deleted=1/);
    await page.getByText(/listing deleted/i).first().waitFor();
    await page.locator("tr", { hasText: partB }).waitFor({ state: "detached" });
  });
});
