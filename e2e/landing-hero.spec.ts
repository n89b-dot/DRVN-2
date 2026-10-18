import { expect, test, type Page } from "@playwright/test";

/**
 * Landing hero acceptance, on the unmodified page (R2-07; rewritten for the
 * marketplace-first landing, F-1 revised 2026-10-17).
 *
 * The hero is now a fixed photograph (`public/landing/rx7-garage.jpg`), not
 * the newest member's car, so no fixture or cache wait is needed to know what
 * it shows. The live parts strip laid over it depends on the stack's
 * listings and is checked only for fit when it renders.
 *
 * What the front door must do at every width and theme: say what DRVN is and
 * offer both actions on the first screen, above the photo, unobscured; never
 * scroll sideways; keep its frame when the photo fails.
 */

const WIDTHS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
type Motion = "reduce" | "no-preference";

const HERO_IMAGE = "rx7-garage";
const heroRequest = (url: URL) => url.toString().includes(HERO_IMAGE);

async function openLanding(
  page: Page,
  { theme, motion = "reduce", image = "loads" }: { theme: Theme; motion?: Motion; image?: "loads" | "fails" },
) {
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "ls-theme", value: theme === "dark" ? "night" : "day", url: baseURL }]);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: motion });
  await page.goto("/");

  const html = page.locator("html");
  if (theme === "dark") await expect(html).toHaveAttribute("data-theme", "dark");
  else await expect(html).not.toHaveAttribute("data-theme", "dark");

  const hero = page.locator(".landing-hero");
  await expect(hero).toBeVisible();
  const img = hero.locator(".landing-hero__photo img");
  await expect
    .poll(
      () =>
        img.evaluate((el: HTMLImageElement, want) =>
          want === "loads" ? el.complete && el.naturalWidth > 0 : el.complete && el.naturalWidth === 0,
        image),
      { message: `hero photo ${image === "loads" ? "loads" : "fails"}`, timeout: 30_000 },
    )
    .toBe(true);

  await page.evaluate(() => document.fonts.ready);
  // With motion allowed, measure after the reveals land — not mid-spring.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  return hero;
}

/** The two front-door actions live in the page head directly above the hero. */
const heroActions = (page: Page) => page.locator("main header.pagehead").getByRole("link");

async function assertHeroLayoutFits(page: Page, label: string) {
  await expect(page.locator("main h1")).toHaveText(/parts marketplace for modified cars/i);
  const actions = heroActions(page);
  await expect(actions).toHaveCount(2);
  await expect(actions.nth(0)).toHaveText("Shop parts for my car");
  await expect(actions.nth(1)).toHaveText("Sell my parts");

  const geometry = await page.evaluate(() => {
    const doc = document.documentElement;
    const photo = document.querySelector(".landing-hero__photo")!.getBoundingClientRect();
    const floor = document.querySelector(".landing-floor")?.getBoundingClientRect() ?? null;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      innerHeight: window.innerHeight,
      photo: { left: photo.left, right: photo.right, top: photo.top + window.scrollY, width: photo.width, height: photo.height },
      floor: floor && { left: floor.left, right: floor.right },
    };
  });

  expect(geometry.scrollWidth, `horizontal overflow on ${label}`).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.photo.width, `photo has width on ${label}`).toBeGreaterThan(0);
  expect(geometry.photo.height, `photo has height on ${label}`).toBeGreaterThan(0);
  expect(geometry.photo.left, `photo starts inside the viewport on ${label}`).toBeGreaterThanOrEqual(0);
  expect(geometry.photo.right, `photo ends inside the viewport on ${label}`).toBeLessThanOrEqual(geometry.clientWidth + 0.5);
  if (geometry.floor) {
    expect(geometry.floor.left, `parts strip inside the viewport on ${label}`).toBeGreaterThanOrEqual(0);
    expect(geometry.floor.right, `parts strip inside the viewport on ${label}`).toBeLessThanOrEqual(geometry.clientWidth + 0.5);
  }

  for (let index = 0; index < 2; index += 1) {
    const action = actions.nth(index);
    await expect(action, `action ${index + 1} visible on ${label}`).toBeVisible();
    // On the first screen, before any scrolling.
    const firstScreen = await action.evaluate((element) => element.getBoundingClientRect().bottom <= window.innerHeight);
    expect(firstScreen, `action ${index + 1} is on the first screen on ${label}`).toBe(true);
    const probe = await action.evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom + window.scrollY,
        width: rect.width,
        height: rect.height,
        hitIsAction: !!hit && element.contains(hit),
        hit: hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join(".")}` : "nothing",
      };
    });
    expect(probe.width * probe.height, `action ${index + 1} has area on ${label}`).toBeGreaterThan(0);
    expect(probe.left, `action ${index + 1} inside the viewport on ${label}`).toBeGreaterThanOrEqual(0);
    expect(probe.right, `action ${index + 1} inside the viewport on ${label}`).toBeLessThanOrEqual(geometry.clientWidth + 0.5);
    expect(probe.bottom, `action ${index + 1} sits above the hero photo on ${label}`).toBeLessThanOrEqual(geometry.photo.top + 0.5);
    expect(probe.hitIsAction, `action ${index + 1} is obscured by ${probe.hit} on ${label}`).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
}

for (const viewport of WIDTHS) {
  const size = `${viewport.width}x${viewport.height}`;

  test.describe(`landing hero @ ${size}`, () => {
    test.use({ viewport });

    for (const theme of THEMES) {
      for (const motion of ["reduce", "no-preference"] as const) {
        test(`hero fits (${theme}, motion ${motion})`, async ({ page }) => {
          await openLanding(page, { theme, motion });
          await assertHeroLayoutFits(page, `${size} ${theme} motion=${motion}`);
        });
      }

      test(`failed hero photo still fits and its actions work (${theme})`, async ({ page }) => {
        await page.route(heroRequest, (route) => route.abort("failed"));
        await openLanding(page, { theme, image: "fails" });
        // The fallback ground keeps the photo's frame; it doesn't collapse.
        const frame = await page.locator(".landing-hero__photo").boundingBox();
        expect(frame?.height ?? 0, "photo frame keeps its height").toBeGreaterThan(100);
        await assertHeroLayoutFits(page, `${size} ${theme} photo failed`);
        // "Shop parts for my car" jumps to the car picker.
        await heroActions(page).nth(0).click();
        await expect(page).toHaveURL(/#your-car$/);
        await expect(page.locator("#your-car")).toBeInViewport();
      });
    }
  });
}

// Keyboard: from the top of the page, Tab reaches the first action before the
// second, the next stop after it is the second, and each shows the focus ring.
for (const viewport of [WIDTHS[0], WIDTHS[WIDTHS.length - 1]]) {
  const size = `${viewport.width}x${viewport.height}`;

  test.describe(`landing hero keyboard @ ${size}`, () => {
    test.use({ viewport });

    for (const theme of THEMES) {
      test(`Tab reaches the hero actions in order with visible focus (${theme})`, async ({ page }) => {
        await openLanding(page, { theme });
        const actions = heroActions(page);
        await expect(actions).toHaveCount(2);
        const isFocused = (index: number) => actions.nth(index).evaluate((element) => element === document.activeElement);

        let presses = 0;
        while (!(await isFocused(0))) {
          expect(await isFocused(1), "Sell my parts was reached before the first action").toBe(false);
          expect(presses, "Tab never reached the hero actions").toBeLessThan(60);
          await page.keyboard.press("Tab");
          presses += 1;
        }

        for (let index = 0; index < 2; index += 1) {
          if (index === 1) await page.keyboard.press("Tab");
          expect(await isFocused(index), `Tab moves to action ${index + 1}`).toBe(true);
          const focus = await actions.nth(index).evaluate((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return {
              focusVisible: element.matches(":focus-visible"),
              outlineStyle: style.outlineStyle,
              outlineWidth: parseFloat(style.outlineWidth),
              inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= document.documentElement.clientWidth,
              unobscured: !!hit && element.contains(hit),
            };
          });
          expect(focus.focusVisible, `action ${index + 1} matches :focus-visible`).toBe(true);
          expect(focus.outlineStyle, `action ${index + 1} draws a focus ring`).not.toBe("none");
          expect(focus.outlineWidth, `action ${index + 1} focus ring has width`).toBeGreaterThan(0);
          expect(focus.inViewport, `focused action ${index + 1} is on screen`).toBe(true);
          expect(focus.unobscured, `focused action ${index + 1} is not covered`).toBe(true);
        }
      });
    }
  });
}
