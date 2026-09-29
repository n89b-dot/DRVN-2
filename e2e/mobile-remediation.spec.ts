import { createDiscoveryFixture } from "./fixtures";
import { expect, test, type Page } from "@playwright/test";

import { addCar, cleanupE2eUsers, makeUser, signIn, signUp } from "./helpers";

/**
 * The regression floor for the mobile remediation pass.
 *
 * `responsive.spec.ts` proves the anonymous surfaces don't overflow, and
 * `mobile-layout.spec.ts` pins the phone presentation of the buy funnel. What
 * neither covers is the *reason* each of those layouts was rewritten: a
 * behaviour that a plain "does it fit" check would happily pass while the
 * screen was unusable. A tab strip that wraps into a two-row wall still fits.
 * A cart whose checkout action sits three screens down still fits. A form row
 * that drops its captions still fits. So each test here asserts the mechanism
 * — flex-wrap, scroll geometry, caption visibility, one-field-per-row, touch
 * height, filter query composition — and asserts its desktop counterpart too,
 * so a fix aimed at phones can't quietly be applied at every width.
 *
 * Deliberately no visual baselines: these are contracts about layout
 * behaviour, and a screenshot would fail on unrelated data churn instead.
 */

let discovery: Awaited<ReturnType<typeof createDiscoveryFixture>>;
test.beforeAll(async () => { discovery = await createDiscoveryFixture(); });

const stamp = Date.now();
const owner = makeUser("mr-owner", stamp);
const carName = `E2E MR Car ${stamp}`;

/** `/garage/<id>/edit` for the car created in setup. */
let carEditPath = "";

/** Copied verbatim from responsive.spec.ts — the helper there is file-local. */
async function assertNoHorizontalOverflow(page: Page, label: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `horizontal overflow on ${label}`).toBeLessThanOrEqual(clientWidth + 1);
}

/**
 * Resize and let the layout land. Every surface under test switches on CSS
 * alone, so no reload is needed — but the measurements below read geometry
 * directly, which needs a frame to have been painted at the new width.
 */
async function resizeTo(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

/** The inner (padding-excluded) width a `.finder` plate offers its controls. */
async function finderContentWidth(page: Page) {
  return page.locator(".finder").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  });
}

/** Adds this suite's own listing through the real guest cart UI. */
async function seedGuestCart(page: Page): Promise<void> {
  await page.goto(discovery.listingPath);
  await page.getByRole("button", { name: /add to cart/i }).click();
  await expect(page.getByRole("link", { name: /in cart/i })).toBeVisible();
}

test.describe.serial("mobile remediation", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("setup: an owner signs up and files a car", async ({ page }) => {
    await signUp(page, owner);
    await addCar(page, carName);
    carEditPath = new URL(page.url()).pathname;
    expect(carEditPath, "addCar must leave us on the car's edit view").toMatch(
      /^\/garage\/[\w-]+\/edit$/
    );
  });

  test("car sheet: the tab strip holds one scrolling line on phones", async ({ page }) => {
    await page.goto(discovery.carPath);
    const strip = page.locator(".tabstrip");
    await expect(strip, "the car sheet must render its tab strip").toBeVisible();

    for (const width of [320, 375, 430, 1440]) {
      await resizeTo(page, width);
      await assertNoHorizontalOverflow(page, `/cars/lancia-delta-hf-integrale @ ${width}`);

      const strip_ = await strip.evaluate((el) => {
        const tabs = [...el.querySelectorAll('[role="tab"]')];
        const boxes = tabs.map((t) => t.getBoundingClientRect());
        return {
          flexWrap: getComputedStyle(el).flexWrap,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          tabCount: tabs.length,
          rows: new Set(boxes.map((b) => Math.round(b.top))).size,
          minTabHeight: Math.min(...boxes.map((b) => b.height)),
        };
      });

      expect(strip_.tabCount, `tab count @ ${width}`).toBeGreaterThan(1);

      if (width === 1440) {
        // Nothing to wrap at desktop width — the strip goes back to being a
        // plain wrapping chip row rather than a permanently scrollable one.
        expect(strip_.flexWrap, `.tabstrip must wrap again @ ${width}`).toBe("wrap");
        continue;
      }

      expect(strip_.flexWrap, `.tabstrip must not wrap @ ${width}`).toBe("nowrap");
      expect(
        strip_.scrollWidth,
        `.tabstrip must scroll sideways rather than wrap @ ${width}`
      ).toBeGreaterThan(strip_.clientWidth);
      expect(strip_.rows, `every tab must share one row @ ${width}`).toBe(1);
      expect(strip_.minTabHeight, `smallest tab tap height @ ${width}`).toBeGreaterThanOrEqual(44);
    }
  });

  test("cart: the phone checkout bar is reachable and retires on desktop", async ({ page }) => {
    await seedGuestCart(page);

    await page.goto("/cart");
    const bar = page.locator(".buybar--wide");
    await expect(bar, "a cart with something buyable must offer the fixed bar").toBeVisible();

    for (const width of [320, 375, 430, 768, 1440]) {
      await resizeTo(page, width);
      await assertNoHorizontalOverflow(page, `/cart @ ${width}`);

      if (width === 1440) {
        // The side column is back, so its own "Proceed to checkout" is on
        // screen — a second fixed copy would just be chrome.
        const display = await bar.evaluate((el) => getComputedStyle(el).display);
        expect(display, `.buybar--wide must retire @ ${width}`).toBe("none");
        continue;
      }

      if (width !== 375) continue;

      const checkout = bar.locator('a[href="/checkout"]');
      await expect(checkout, "the bar's checkout link @ 375").toBeVisible();
      const checkoutBox = await checkout.boundingBox();
      expect(checkoutBox!.height, "buybar checkout tap height @ 375").toBeGreaterThanOrEqual(44);

      const bodyPadding = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.body).paddingBottom)
      );
      expect(
        bodyPadding,
        "body must reserve clearance for the fixed bar @ 375"
      ).toBeGreaterThanOrEqual(76);

      // With the page fully scrolled, that clearance has to actually work:
      // the last content clears the bar instead of sitting under it.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const { footBottom, barTop } = await page.evaluate(() => {
        const foot = document.querySelector("footer.foot")!.getBoundingClientRect();
        const el = document.querySelector(".buybar--wide")!.getBoundingClientRect();
        return { footBottom: foot.bottom, barTop: el.top };
      });
      expect(footBottom, "Foot must clear the fixed cart bar @ 375").toBeLessThanOrEqual(
        barTop + 1
      );
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  });

  test("mods editor: the ledger line becomes a labelled record on a phone", async ({ page }) => {
    await signIn(page, owner);
    await page.goto(carEditPath);

    const rows = page.locator(".modrow");
    if ((await rows.count()) === 0) {
      await page.getByRole("button", { name: /add a line manually/i }).click();
    }
    const row = rows.first();
    await expect(row, "the editor must hold at least one mod line").toBeVisible();

    for (const width of [320, 375, 430, 1024]) {
      await resizeTo(page, width);
      await assertNoHorizontalOverflow(page, `${carEditPath} @ ${width}`);

      const shape = await row.evaluate((el) => {
        const labels = [...el.querySelectorAll<HTMLElement>(".modrow__lab")];
        const ctls = [...el.querySelectorAll<HTMLElement>(".ctl")];
        const remove = el.querySelector<HTMLElement>(".modrow__rm");
        return {
          display: getComputedStyle(el).display,
          visibleLabels: labels
            .filter((l) => l.getBoundingClientRect().height > 1)
            .map((l) => l.textContent?.trim() ?? ""),
          ctlCount: ctls.length,
          distinctCtlRows: new Set(
            ctls.map((c) => Math.round(c.getBoundingClientRect().top))
          ).size,
          removeHeight: remove ? remove.getBoundingClientRect().height : 0,
        };
      });

      expect(shape.ctlCount, `.modrow field count @ ${width}`).toBe(5);

      if (width === 1024) {
        expect(shape.display, `.modrow must be a ledger line @ ${width}`).toBe("flex");
        expect(
          shape.visibleLabels,
          `captions must stay hidden where the column says it @ ${width}`
        ).toEqual([]);
        expect(
          shape.distinctCtlRows,
          `fields must share rows on a ledger line @ ${width}`
        ).toBeLessThan(5);
        continue;
      }

      if (width === 430) continue; // overflow-only at this width

      expect(shape.display, `.modrow must be a stacked record @ ${width}`).toBe("grid");
      expect(shape.visibleLabels, `record captions @ ${width}`).toEqual([
        "Brand",
        "Product",
        "Part number",
        "Category",
      ]);
      expect(shape.distinctCtlRows, `every field gets its own row @ ${width}`).toBe(
        shape.ctlCount
      );
      expect(shape.removeHeight, `Remove tap height @ ${width}`).toBeGreaterThanOrEqual(44);
    }
  });

  test("mods editor: the commit row stacks and goes full width on a phone", async ({ page }) => {
    await signIn(page, owner);
    await page.goto(carEditPath);

    const saverow = page.locator(".saverow").first();
    await expect(saverow).toBeVisible();

    for (const width of [375, 1024]) {
      await resizeTo(page, width);

      const shape = await saverow.evaluate((el) => {
        const btn = el.querySelector<HTMLElement>(".btn")!;
        return {
          flexDirection: getComputedStyle(el).flexDirection,
          rowWidth: el.getBoundingClientRect().width,
          btnWidth: btn.getBoundingClientRect().width,
        };
      });
      const share = shape.btnWidth / shape.rowWidth;

      if (width === 375) {
        expect(shape.flexDirection, `.saverow must stack @ ${width}`).toBe("column");
        expect(share, `commit button share of the row @ ${width}`).toBeGreaterThanOrEqual(0.9);
      } else {
        expect(shape.flexDirection, `.saverow must be one line @ ${width}`).toBe("row");
        expect(share, `commit button share of the row @ ${width}`).toBeLessThan(0.6);
      }
    }
  });

  test("saved: search owns the phone column and Enter submits the query", async ({ page }) => {
    await signIn(page, owner);
    await page.goto("/saved");
    const finder = page.locator(".finder").first();
    await expect(finder).toBeVisible();
    const search = finder.locator(".search");
    for (const width of [320, 375, 430, 768]) {
      await resizeTo(page, width);
      await assertNoHorizontalOverflow(page, `/saved @ ${width}`);
      const content = await finderContentWidth(page);
      const searchWidth = (await search.boundingBox())!.width;
      if (width === 375) expect(searchWidth / content).toBeGreaterThanOrEqual(0.9);
      if (width === 768) expect(searchWidth).toBeGreaterThan(300);
    }
    await page.getByLabel("Search saved parts").fill("brakes");
    await page.getByLabel("Search saved parts").press("Enter");
    await expect(page).toHaveURL(/q=brakes/);
  });

  test("notifications: two filter axes, one row each, still combining in the query", async ({
    page,
  }) => {
    await signIn(page, owner);
    await page.goto("/notifications");

    const groups = page.locator('[role="group"]');
    await expect(groups, "notifications draws exactly two filter groups").toHaveCount(2);
    const readState = page.getByRole("group", { name: /read state/i });
    const type = page.getByRole("group", { name: /type/i });
    await expect(readState, "the read-state group").toBeVisible();
    await expect(type, "the type group").toBeVisible();

    for (const width of [320, 375, 430]) {
      await resizeTo(page, width);
      await assertNoHorizontalOverflow(page, `/notifications @ ${width}`);

      for (const [label, group] of [
        ["read state", readState],
        ["type", type],
      ] as const) {
        const rowCount = await group.evaluate((el) => {
          const chips = [...el.querySelectorAll<HTMLElement>(".fbtn")];
          return new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top))).size;
        });
        expect(rowCount, `the ${label} chips must stay on one row @ ${width}`).toBe(1);
      }
    }

    // The two axes are drawn apart precisely because they combine — so the
    // query contract is part of the layout's justification, not separate to it.
    await readState.getByRole("link", { name: /^unread$/i }).click();
    await expect(page, "picking a read state").toHaveURL(/filter=unread/);

    await type.getByRole("link", { name: /^marketplace$/i }).click();
    await expect(page, "type must add to the read state, not replace it").toHaveURL(
      /filter=unread/
    );
    await expect(page, "type must be carried in the query").toHaveURL(/section=marketplace/);

    await type.getByRole("link", { name: /^your builds$/i }).click();
    await expect(page, "read state survives a second type change").toHaveURL(/filter=unread/);
    await expect(page, "the type swaps within its own axis").toHaveURL(/section=engagement/);
  });

  test("messages: search owns the phone column and Enter submits", async ({ page }) => {
    await signIn(page, owner);
    await page.goto("/messages");
    const finder = page.locator(".finder").first();
    await expect(finder).toBeVisible();
    const search = finder.locator(".search");
    for (const width of [320, 375, 430, 768]) {
      await resizeTo(page, width);
      await assertNoHorizontalOverflow(page, `/messages @ ${width}`);
      const content = await finderContentWidth(page);
      if (width === 375) expect((await search.boundingBox())!.width / content).toBeGreaterThanOrEqual(0.9);
    }
    const field = page.getByLabel("Search people, parts and messages");
    await field.fill("brakes");
    await field.press("Enter");
    await expect(page).toHaveURL(/q=brakes/);
  });

  test("checkout: the compact summary stands in for the desktop aside", async ({ page }) => {
    await seedGuestCart(page);

    await page.goto("/checkout");
    await expect(page).toHaveURL(/\/checkout/);

    const aside = page.locator("aside.max-lg\\:hidden");
    const compact = page.locator("details.ordersum");

    await resizeTo(page, 375);
    await expect(aside, "the desktop rail must be gone on a phone").toBeHidden();
    await expect(compact, "the compact summary stands in for it").toBeVisible();
    const total = await compact.locator(".ordersum__total").innerText();
    expect(total, "the order total must stay on screen @ 375").toMatch(/\$[\d,]+/);

    await resizeTo(page, 1440);
    await expect(aside, "the rail is back at desktop width").toBeVisible();
    await expect(compact, "and the compact stand-in retires").toBeHidden();
  });
});

test.afterAll(async () => {
  await cleanupE2eUsers();
  await discovery?.cleanup();
});
