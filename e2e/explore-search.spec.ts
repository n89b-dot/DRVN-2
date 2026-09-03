import { expect, test } from "@playwright/test";

import { addCar, enableSellerPayouts, makeUser, publishListing, signIn, signUp } from "./helpers";

/**
 * Unified Explore search (brief: Explore search, Aug 2026).
 *
 * One serial journey (workers:1, per the project convention): a fresh user
 * seeds a public build, a private build and an active listing, then the spec
 * walks free-text search per scope, grouped All results, account discovery,
 * autocomplete keyboard behavior, filter chips, scope-transition cleaning,
 * the empty state, and the privacy exclusions (private build + its absence
 * from suggestions).
 */

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const user = makeUser("xsearch", stamp);
// Single-token, letter-only names on purpose: search is word-wise, so a
// two-word name ("Ghost Sedan 123") would match ANOTHER run's leftover
// "Ghost Sedan 456" through the shared words — and a digit-bearing single
// token would classify as a part identifier on the Parts lane.
// …and the private car gets a DIFFERENT unique token: sharing a long suffix
// with the public car would let trigram word-similarity (the typo-forgiveness
// lane) bridge the two names.
const uniq = String(stamp).replace(/\d/g, (d) => "abcdefghij"[Number(d)]);
const uniq2 = String(stamp).replace(/\d/g, (d) => "klmnopqrst"[Number(d)]);
const publicCar = `zephyrwagon${uniq}`;
const privateCar = `ghostsedan${uniq2}`;
const partTitle = `fluxmanifold${uniq}`;

test("seeds a user with a public build, a private build and a listing", async ({ page }) => {
  await signUp(page, user);

  // Private build first: flip its visibility off on the edit sheet.
  await addCar(page, privateCar);
  await page.getByLabel(/public sheet/i).uncheck();
  await page.getByRole("button", { name: /save changes/i }).click();
  // The save round-trips through the server action; the button leaves its
  // pending state when the response lands. Reload and confirm persistence.
  await expect(page.getByRole("button", { name: /save changes/i })).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel(/public sheet/i)).not.toBeChecked();

  await addCar(page, publicCar);

  await enableSellerPayouts(user.username);
  await publishListing(page, {
    title: partTitle,
    price: "120",
    shipping: "10",
    sourceCarLabel: `Off my sheet — ${publicCar}`,
  });
});

test("free-text search finds the public build; browse mode stays the feed", async ({ page }) => {
  // Browse mode: no query — the normal wall, no search empty state.
  await page.goto("/explore");
  await expect(page.getByRole("search")).toBeVisible();
  await expect(page.getByText(/no results/i)).toHaveCount(0);

  // Search mode via URL (shareable/reload-safe by construction). Assert the
  // result CARD (article), not any link — the removable query chip also
  // carries the term in its accessible name.
  await page.goto(`/explore?q=${encodeURIComponent(publicCar)}`);
  await expect(page.locator("article").filter({ hasText: publicCar }).first()).toBeVisible();
  // Grouped All view: the Builds group head with its view-all handoff.
  await expect(page.getByRole("heading", { name: /builds/i }).first()).toBeVisible();
  // The applied-query chip renders and is removable.
  await expect(page.getByRole("link", { name: /remove filter/i }).first()).toBeVisible();
});

test("the Builds scope works and the private build never surfaces", async ({ page }) => {
  await page.goto(`/explore?tab=cars&q=${encodeURIComponent(publicCar)}`);
  await expect(page.locator("article").filter({ hasText: publicCar }).first()).toBeVisible();

  await page.goto(`/explore?tab=cars&q=${encodeURIComponent(privateCar)}`);
  await expect(page.getByText(/no builds match/i)).toBeVisible();
  // No result CARD for the private build (the removable query chip still
  // carries the term in its accessible name, so scope this to build cards).
  await expect(page.getByRole("link", { name: new RegExp(`Build ${privateCar}`, "i") })).toHaveCount(0);
});

test("accounts are discoverable by identity in All results", async ({ page }) => {
  await page.goto(`/explore?q=${encodeURIComponent(user.username)}`);
  await expect(page.getByRole("heading", { name: /accounts/i })).toBeVisible();
  await expect(page.getByText(`@${user.username}`).first()).toBeVisible();
});

test("the Parts scope reuses marketplace search with its refinements", async ({ page }) => {
  // Parts are a signed-in scope (PRD §8.2) — each Playwright test gets a
  // fresh context, so authenticate first.
  await signIn(page, user);
  await page.goto(`/explore?tab=parts&q=${encodeURIComponent(partTitle)}`);
  await expect(page.locator("article").filter({ hasText: partTitle }).first()).toBeVisible();

  // A price bound that excludes the listing produces the honest empty state.
  await page.goto(`/explore?tab=parts&q=${encodeURIComponent(partTitle)}&min=5000`);
  await expect(page.getByText(/no parts match/i)).toBeVisible();
});

test("scope transitions shed incompatible filters and keep compatible ones", async ({ page }) => {
  await signIn(page, user);
  await page.goto(
    `/explore?tab=parts&q=${encodeURIComponent(publicCar)}&condition=used&min=10&ymin=2000`
  );
  await page.getByRole("link", { name: /^builds$/i }).click();
  await page.waitForURL(/tab=cars/);
  const url = new URL(page.url());
  expect(url.searchParams.get("q")).toBe(publicCar);
  expect(url.searchParams.get("condition")).toBeNull();
  expect(url.searchParams.get("min")).toBeNull();
  // Year is shared across scopes; Builds applies it to the car itself.
  expect(url.searchParams.get("ymin")).toBe("2000");
});

test("autocomplete suggests, supports the keyboard, and excludes private builds", async ({
  page,
}) => {
  await page.goto("/explore");
  const input = page.getByRole("combobox", { name: /search drvn/i });
  await input.click();
  await input.fill(publicCar.slice(0, 12));

  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const option = page.getByRole("option", { name: new RegExp(publicCar, "i") });
  await expect(option).toBeVisible();

  // Escape closes the popover but keeps the text.
  await input.press("Escape");
  await expect(listbox).toHaveCount(0);
  await expect(input).toHaveValue(publicCar.slice(0, 12));

  // Arrow down reopens; Enter on the active option navigates to the build.
  await input.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await input.press("Enter");
  await page.waitForURL(/\/cars\//);

  // A private build never suggests.
  await page.goto("/explore");
  await input.click();
  await input.fill(privateCar.slice(0, 12));
  // Give the debounce + request time to settle, then assert absence.
  await page.waitForTimeout(800);
  await expect(page.getByRole("option", { name: new RegExp(privateCar, "i") })).toHaveCount(0);
});

test("plain Enter submits the query as a URL search", async ({ page }) => {
  await page.goto("/explore");
  const input = page.getByRole("combobox", { name: /search drvn/i });
  await input.click();
  await input.fill(publicCar);
  await page.waitForTimeout(400);
  // No option selected: Enter is a normal GET submit.
  await input.press("Enter");
  await page.waitForURL(/\/explore\?/);
  expect(new URL(page.url()).searchParams.get("q")).toBe(publicCar);
});
