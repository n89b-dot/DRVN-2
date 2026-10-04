import { randomUUID } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

/**
 * Landing hero acceptance, with the hero VISIBLE and the layout unmodified
 * (R2-07). `responsive.spec.ts` hides `.landing-hero` so its baselines don't
 * depend on which car is newest; that left a clipped or oversized hero free
 * to pass. This suite measures the real page instead — no injected styles,
 * no hidden elements.
 *
 * Which car is the hero: `src/app/page.tsx` takes the newest public car with a
 * cover photo (`order created_at desc`), through a fetch cached for 60 s
 * (`revalidate: 60`, tag `landing`; nothing revalidates the tag). Determinism:
 *
 * - The fixture car is created with `created_at` a century in the future, so
 *   it outranks every car another suite creates (they all use `now()`). A
 *   fixture leaked from an earlier run is outranked too: each run's century
 *   starts later.
 * - Because the read is cached (stale-while-revalidate), `beforeAll` reloads
 *   `/` until the hero is this run's cover photo, then every test re-checks
 *   that before it measures. A stale cache can delay the suite; it can never
 *   let it measure another car. `afterAll` deletes the cars and reloads the
 *   same way until the cached read has dropped them, so the suites after
 *   this one see the landing page they would have seen without it.
 * - The config runs one worker and never splits a file across workers, so no
 *   other spec writes cars while this one runs.
 *
 * Hero ABSENT is not covered here: it needs no public car with a cover on the
 * whole stack, and other suites keep theirs (retained ledger fixtures among
 * them). Making it deterministic needs either a fresh stack for that one test
 * or a product seam that lets a test choose the landing query's result.
 * Removing the node in the browser would not be the same page: the absent
 * branch also swaps the builds grid for its empty state.
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

/** `.landing-hero { max-height: 56vh }` (08-forms.css): the hero stops short
 *  of the fold so "what DRVN is" starts on the first screen. */
const HERO_MAX_VIEWPORT_SHARE = 0.56;

/** A real image of a given size, so the hero lays out a photo with intrinsic
 *  dimensions rather than a 1×1 pixel. Solid RGB, built with node:zlib. */
function solidPng(width: number, height: number, [r, g, b]: [number, number, number]) {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const LANDSCAPE = solidPng(1600, 900, [72, 84, 96]);
/** Unusually shaped media for the long-content case. */
const TALL = solidPng(300, 1500, [120, 60, 40]);
const WIDE = solidPng(2400, 150, [40, 90, 120]);

/** The longest name a member can save — 120 characters, the `cars_text_bounds`
 *  cap (the garage form has none of its own) — mostly one unbroken run that
 *  only wraps if the card allows it. */
const LONG_TOKEN = "Twinturbosequentialantilagbillet";
const LONG_NAME = `R34 V-Spec II Nür — ${LONG_TOKEN.repeat(4)}`.slice(0, 120);

type Fixture = { userId: string; objects: string[]; heroPath: string };
let fixture: Fixture | undefined;

async function createFixture(): Promise<Fixture> {
  const admin = fixtureAdmin();
  const token = randomUUID();
  const user = await admin.auth.admin.createUser({ email: `e2e-landing-hero-${token}@drvn.test`, email_confirm: true });
  if (user.error || !user.data.user) throw user.error ?? new Error("Landing hero fixture user missing");
  const userId = user.data.user.id;
  const heroPath = `${userId}/landing-hero-${token}.png`;
  const longPath = `${userId}/landing-long-${token}.png`;
  const created: Fixture = { userId, objects: [], heroPath };
  try {
    for (const [path, body] of [[heroPath, LANDSCAPE], [longPath, TALL]] as const) {
      const upload = await admin.storage.from("car-images").upload(path, body, { contentType: "image/png" });
      if (upload.error) throw upload.error;
      created.objects.push(path);
    }
    const cover = (path: string) => admin.storage.from("car-images").getPublicUrl(path).data.publicUrl;
    const century = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000;
    const cars = await admin.from("cars").insert([
      // The hero: newest public car with a cover.
      { owner_id: userId, slug: `landing-hero-${token}`, name: "Landing hero fixture", year: 1999, make: "Nissan", model: "Skyline GT-R", is_public: true, cover_image_url: cover(heroPath), created_at: new Date(century).toISOString() },
      // Second in "Builds on DRVN": the long-content card.
      { owner_id: userId, slug: `landing-long-${token}`, name: LONG_NAME, is_public: true, cover_image_url: cover(longPath), created_at: new Date(century - 60_000).toISOString() },
    ]);
    if (cars.error) throw cars.error;
    return created;
  } catch (error) {
    await removeFixture(created);
    throw error;
  }
}

async function removeFixture({ userId, objects }: Fixture) {
  const admin = fixtureAdmin();
  if (objects.length) {
    const removed = await admin.storage.from("car-images").remove(objects);
    if (removed.error) throw removed.error;
  }
  await cleanupFixtureUser(userId);
}

const heroSrc = (page: Page) =>
  page.evaluate(() => document.querySelector(".landing-hero img")?.getAttribute("src") ?? "");

const isFixtureHero = (src: string, heroPath: string) => {
  try {
    return decodeURIComponent(src).includes(heroPath);
  } catch {
    return false;
  }
};

/** Reload until the cached landing read serves (or, after cleanup, no longer
 *  serves) this run's cars. */
async function waitForLanding(browser: Browser, heroPath: string, want: "fixture" | "no fixture") {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    await expect
      .poll(
        async () => {
          await page.goto("/");
          const hero = isFixtureHero(await heroSrc(page), heroPath);
          if (want === "fixture") return hero;
          return !hero && !(await page.content()).includes(LONG_TOKEN);
        },
        {
          message: `the landing page never served ${want === "fixture" ? "the fixture car as its hero" : "a page without the fixture cars"} (the landing read is cached for 60 s)`,
          timeout: 150_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toBe(true);
  } finally {
    await context.close();
  }
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  fixture = await createFixture();
  await waitForLanding(browser, fixture.heroPath, "fixture");
});

// Leave the shared landing cache as we found it. Deleted rows stay in the
// cached read for up to a minute; a later suite on the same server (the
// responsive baselines run next) would otherwise render this run's
// far-future cars, and the 120-character name pushes the page down.
test.afterAll(async ({ browser }) => {
  if (!fixture) return;
  test.setTimeout(240_000);
  await removeFixture(fixture);
  await waitForLanding(browser, fixture.heroPath, "no fixture");
});

function heroPathOrThrow() {
  if (!fixture) throw new Error("Landing hero fixture missing");
  return fixture.heroPath;
}

/** Route predicate for the hero cover, direct or through the image optimizer. */
const heroRequest = (heroPath: string) => (url: URL) => isFixtureHero(url.toString(), heroPath);

async function openLanding(
  page: Page,
  { theme, motion = "reduce", image = "loads" }: { theme: Theme; motion?: Motion; image?: "loads" | "fails" },
) {
  const heroPath = heroPathOrThrow();
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "ls-theme", value: theme === "dark" ? "night" : "day", url: baseURL }]);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: motion });
  await page.goto("/");

  const html = page.locator("html");
  if (theme === "dark") await expect(html).toHaveAttribute("data-theme", "dark");
  else await expect(html).not.toHaveAttribute("data-theme", "dark");

  const hero = page.locator(".landing-hero");
  await expect(hero).toBeVisible();
  // The determinism check: the hero is this run's car, not whatever is newest.
  expect(isFixtureHero(await heroSrc(page), heroPath), "hero is the fixture car's cover").toBe(true);

  const img = hero.locator("img");
  if (image === "loads") {
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
        message: "hero photo loads",
        timeout: 30_000,
      })
      .toBe(true);
  } else {
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth === 0), {
        message: "hero photo failed",
        timeout: 30_000,
      })
      .toBe(true);
  }

  await page.evaluate(() => document.fonts.ready);
  // With motion allowed, measure after the reveals land — not mid-spring.
  // Infinite loops (the live accents) are decoration and never finish.
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

/**
 * The page with the hero visible fits: no sideways scroll, the hero inside the
 * viewport width and short of the fold, and both actions on screen, above the
 * photo, and the topmost thing at their own centre.
 */
async function assertHeroLayoutFits(page: Page, label: string) {
  const actions = heroActions(page);
  await expect(actions).toHaveCount(2);
  await expect(actions.nth(0)).toHaveText(/^(Add your car|Explore builds)$/);
  await expect(actions.nth(1)).toHaveText("Shop parts");

  const geometry = await page.evaluate(() => {
    const doc = document.documentElement;
    const hero = document.querySelector(".landing-hero")!.getBoundingClientRect();
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      innerHeight: window.innerHeight,
      hero: { left: hero.left, right: hero.right, top: hero.top + window.scrollY, width: hero.width, height: hero.height },
    };
  });

  expect(geometry.scrollWidth, `horizontal overflow on ${label}`).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.hero.width, `hero has width on ${label}`).toBeGreaterThan(0);
  expect(geometry.hero.height, `hero has height on ${label}`).toBeGreaterThan(0);
  expect(geometry.hero.left, `hero starts inside the viewport on ${label}`).toBeGreaterThanOrEqual(0);
  expect(geometry.hero.right, `hero ends inside the viewport on ${label}`).toBeLessThanOrEqual(geometry.clientWidth + 0.5);
  expect(geometry.hero.height, `hero stops short of the fold on ${label}`).toBeLessThanOrEqual(
    geometry.innerHeight * HERO_MAX_VIEWPORT_SHARE + 1,
  );

  for (let index = 0; index < 2; index += 1) {
    const action = actions.nth(index);
    await expect(action, `action ${index + 1} visible on ${label}`).toBeVisible();
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
    expect(probe.bottom, `action ${index + 1} sits above the hero photo on ${label}`).toBeLessThanOrEqual(geometry.hero.top + 0.5);
    expect(probe.hitIsAction, `action ${index + 1} is obscured by ${probe.hit} on ${label}`).toBe(true);
  }
}

for (const viewport of WIDTHS) {
  const size = `${viewport.width}x${viewport.height}`;

  test.describe(`landing hero @ ${size}`, () => {
    test.use({ viewport });

    for (const theme of THEMES) {
      for (const motion of ["reduce", "no-preference"] as const) {
        test(`hero present fits (${theme}, motion ${motion})`, async ({ page }) => {
          await openLanding(page, { theme, motion });
          await assertHeroLayoutFits(page, `${size} ${theme} motion=${motion}`);
        });
      }

      test(`failed hero photo still fits and its actions work (${theme})`, async ({ page }) => {
        await page.route(heroRequest(heroPathOrThrow()), (route) => route.abort("failed"));
        const hero = await openLanding(page, { theme, image: "fails" });
        // The fallback ground keeps the hero's frame; it doesn't collapse.
        await expect(hero).toHaveCSS("display", "block");
        await assertHeroLayoutFits(page, `${size} ${theme} photo failed`);
        await heroActions(page).nth(1).click();
        await expect(page).toHaveURL(/\/marketplace(?:[?#]|$)/);
      });
    }

    for (const [shape, body] of [["tall", TALL], ["wide", WIDE]] as const) {
      test(`long content and a ${shape} photo still fit`, async ({ page }) => {
        await page.route(heroRequest(heroPathOrThrow()), (route) =>
          route.fulfill({ status: 200, contentType: "image/png", body }),
        );
        await openLanding(page, { theme: "light" });
        await assertHeroLayoutFits(page, `${size} ${shape} photo, long name`);

        // The long-named build is the second card under "Builds on DRVN".
        const name = page.locator(".mkt__name", { hasText: LONG_TOKEN });
        await expect(name).toHaveCount(1);
        await name.scrollIntoViewIfNeeded();
        await expect(name).toBeVisible();
        const card = await name.evaluate((element) => {
          const tile = element.closest(".tile")!.getBoundingClientRect();
          return {
            nameOverflows: element.scrollWidth > element.clientWidth,
            left: tile.left,
            right: tile.right,
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          };
        });
        expect(card.nameOverflows, `long build name overflows its line at ${size}`).toBe(false);
        expect(card.left, `long-name card inside the viewport at ${size}`).toBeGreaterThanOrEqual(0);
        expect(card.right, `long-name card inside the viewport at ${size}`).toBeLessThanOrEqual(card.clientWidth + 0.5);
        expect(card.scrollWidth, `horizontal overflow with the long name at ${size}`).toBeLessThanOrEqual(card.clientWidth);
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
          expect(await isFocused(1), "Shop parts was reached before the first action").toBe(false);
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
