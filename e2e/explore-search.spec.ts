import { expect, test, type ConsoleMessage, type Request, type Response } from "@playwright/test";

import { fixtureAdmin } from "./fixtures";
import { addCar, cleanupE2eUsers, enableSellerPayouts, makeUser, publishListing, signIn, signUp } from "./helpers";

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

/**
 * This spec seeds a build whose name shares a prefix with every other run's,
 * and the suggestion groups are capped at three — so without a sweep the
 * autocomplete assertions start matching last week's leftovers instead of
 * this run's car. (27 stale accounts had accumulated before this was added.)
 */
test.afterAll(async () => {
  await cleanupE2eUsers();
});

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

function sanitizedDiagnosticText(value: string): string {
  return value
    .replace(/([?&#](?:code|token|access_token|refresh_token|api[_-]?key)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]+\b/g, "[redacted-provider-key]")
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/gi, "[redacted-supabase-key]");
}

function sanitizedRequestUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

test("seeds a user with a public build, a private build and a listing", async ({ page }, testInfo) => {
  await signUp(page, user);

  // Private build first: flip its visibility off on the edit sheet.
  await addCar(page, privateCar);
  const consoleOutput: string[] = [];
  const networkOutput: string[] = [];
  const captureConsole = (message: ConsoleMessage) => {
    if (["warning", "error"].includes(message.type())) {
      consoleOutput.push(
        `${message.type()}: ${sanitizedDiagnosticText(message.text()).slice(0, 1_000)}`
      );
    }
  };
  const captureRequestFailure = (request: Request) => {
    networkOutput.push(
      `${request.method()} ${sanitizedRequestUrl(request.url())} failed: ` +
        sanitizedDiagnosticText(request.failure()?.errorText ?? "unknown")
    );
  };
  const captureErrorResponse = (response: Response) => {
    if (response.status() >= 400) {
      networkOutput.push(
        `${response.request().method()} ${response.status()} ${sanitizedRequestUrl(response.url())}`
      );
    }
  };
  page.on("console", captureConsole);
  page.on("requestfailed", captureRequestFailure);
  page.on("response", captureErrorResponse);
  const carId = new URL(page.url()).pathname.split("/").at(-2);
  expect(carId).toBeTruthy();
  let persistedState: boolean | string = "not observed";
  const readPersistedVisibility = async () => {
    const { data, error } = await fixtureAdmin()
      .from("cars")
      .select("is_public")
      .eq("id", carId!)
      .single();
    if (error) throw error;
    persistedState = data.is_public;
    return data.is_public;
  };
  try {
    await page.getByLabel(/public sheet/i).uncheck();
    await page.getByRole("button", { name: /save changes/i }).click();

    // Observe the canonical persisted value before navigating. Waiting for the
    // button to be enabled can race React's pending transition and reload while
    // the Server Action is still in flight.
    await expect.poll(readPersistedVisibility).toBe(false);

    // The reloaded form is independent UI evidence that the persisted state is
    // what a subsequent request sees.
    await page.reload();
    await expect(page.getByLabel(/public sheet/i)).not.toBeChecked();
  } catch (error) {
    try {
      await readPersistedVisibility();
    } catch (diagnosticError) {
      persistedState = sanitizedDiagnosticText(`query failed: ${String(diagnosticError)}`);
    }
    await testInfo.attach("car-edit-diagnostics.json", {
      body: JSON.stringify({
        url: sanitizedRequestUrl(page.url()),
        carId,
        persistedState,
        console: consoleOutput.slice(-30),
        network: networkOutput.slice(-50),
      }, null, 2),
      contentType: "application/json",
    });
    throw error;
  } finally {
    page.off("console", captureConsole);
    page.off("requestfailed", captureRequestFailure);
    page.off("response", captureErrorResponse);
  }

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
  await signIn(page, user);
  await page.goto(`/explore?tab=parts&q=${encodeURIComponent(partTitle)}`);
  await expect(page.locator("article").filter({ hasText: partTitle }).first()).toBeVisible();

  // A price bound that excludes the listing produces the honest empty state.
  await page.goto(`/explore?tab=parts&q=${encodeURIComponent(partTitle)}&min=5000`);
  await expect(page.getByText(/no parts match/i)).toBeVisible();
});

/**
 * Journey 3, first half (PRD 2026-09 E-5): the marketplace is a front door,
 * so a stranger with no account finds a part in Explore, in the Parts
 * segment, in search and in the suggestions — the v3.1 §8.2 gate is retired.
 * This test deliberately never signs in; each Playwright test gets a fresh
 * context, so the page is genuinely signed out.
 */
test("a signed-out visitor finds parts in the segment, in search and in suggestions", async ({
  page,
}) => {
  // The segment is offered at all, in browse mode.
  await page.goto("/explore");
  await expect(page.getByRole("link", { name: /^parts$/i }).first()).toBeVisible();

  // The Parts scope itself returns the listing.
  await page.goto(`/explore?tab=parts&q=${encodeURIComponent(partTitle)}`);
  await expect(page.locator("article").filter({ hasText: partTitle }).first()).toBeVisible();

  // The federated All view groups it under Parts, with a working view-all.
  // The group head's accessible name carries its count ("Parts 1"), so this
  // anchors at the start rather than matching the whole name.
  await page.goto(`/explore?q=${encodeURIComponent(partTitle)}`);
  await expect(page.getByRole("heading", { name: /^parts/i }).first()).toBeVisible();
  await expect(page.locator("article").filter({ hasText: partTitle }).first()).toBeVisible();

  // And autocomplete offers it before the results page is reached. From a
  // clean /explore: on the results page the field already holds the query, so
  // filling it with the same text fires no input event and nothing is
  // fetched. The parts lane resolves through the marketplace search provider,
  // which matches whole terms rather than the builds lane's prefixes, so this
  // types the title rather than a fragment of it.
  await page.goto("/explore");
  const input = page.getByRole("combobox", { name: /search drvn/i });
  await input.click();
  await input.fill(partTitle);
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page.getByRole("option", { name: new RegExp(partTitle, "i") })).toBeVisible();
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
  const privateQuery = privateCar.slice(0, 12);
  const privateSuggestions = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/explore/suggest" && url.searchParams.get("q") === privateQuery;
  });
  await input.fill(privateQuery);
  expect((await privateSuggestions).ok()).toBe(true);
  await expect(page.getByRole("option", { name: new RegExp(privateCar, "i") })).toHaveCount(0);
});

test("plain Enter submits the query as a URL search", async ({ page }) => {
  await page.goto("/explore");
  const input = page.getByRole("combobox", { name: /search drvn/i });
  await input.click();
  await input.fill(publicCar);
  // No option selected: Enter is a normal GET submit.
  await Promise.all([
    page.waitForURL(/\/explore\?/),
    input.press("Enter"),
  ]);
  expect(new URL(page.url()).searchParams.get("q")).toBe(publicCar);
});
