import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

/** One photo through /sell's real uploader — publishing requires it. */
async function attachSellPhoto(page: Page) {
  await page.locator('#sell-photos input[type="file"]').setInputFiles({
    name: "part.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    ),
  });
  await expect(page.getByRole("button", { name: /add more photos/i })).toBeVisible({ timeout: 30_000 });
}

/** The in-flow commit button (the phone's pinned bar repeats it). */
const sellCommitButton = (page: Page) => page.locator(".saverow").getByRole("button", { name: /publish/i });

/** A signed-in, invited seller with one live listing (made through /sell). */
async function sellerWithListing(page: Page) {
  const admin = fixtureAdmin();
  const stamp = randomUUID();
  const email = `e2e-listing-edit-${stamp}@drvn.test`;
  const password = `Listing-${randomUUID()}!`;
  const title = `Edit atomic ${stamp}`;
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw user.error ?? new Error("Missing listing user");
  const userId = user.data.user.id;
  const invitationId = randomUUID();

  try {
    const profile = await admin.from("profiles").upsert({
      id: userId,
      username: `edit${stamp.replaceAll("-", "").slice(0, 18)}`,
      payouts_enabled: true,
    });
    if (profile.error) throw profile.error;
    const invited = await admin.from("beta_invitations").insert({
      id: invitationId,
      email_normalized: email,
      roles: ["seller"],
      token_hash: createHash("sha256").update(randomUUID()).digest("hex"),
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      consumed_at: new Date().toISOString(),
      consumed_by: userId,
    });
    if (invited.error) throw invited.error;
    const membership = await admin.from("beta_memberships").insert({
      user_id: userId,
      invitation_id: invitationId,
      email_normalized: email,
      roles: ["seller"],
    });
    if (membership.error) throw membership.error;

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/home/);

    await page.goto("/sell");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Category", { exact: true }).selectOption("performance");
    await page.getByLabel("Asking price").fill("125.00");
    await attachSellPhoto(page);
    await sellCommitButton(page).click();
    await expect(page).toHaveURL(/\/listings\/[0-9a-f-]+$/, { timeout: 20_000 });
    const listingId = new URL(page.url()).pathname.split("/").pop()!;

    const listingRow = async () => {
      const result = await admin
        .from("listings")
        .select("title, price_cents, updated_at, listing_images(url)")
        .eq("id", listingId)
        .single();
      if (result.error) throw result.error;
      return result.data;
    };
    return { userId, title, listingId, listingRow };
  } catch (error) {
    await cleanupFixtureUser(userId);
    throw error;
  }
}

const save = (p: Page) => p.locator(".saverow").getByRole("button", { name: "Save changes" });

// RR-05: a listing edit saves whole, the same form can save twice in a row,
// and a second tab still holding the old version is refused instead of
// silently overwriting the newer save.
test("listing edits save whole and a stale tab can't overwrite a newer save", async ({ page, context }) => {
  test.skip(
    process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation",
    "Listing edit fixtures are restricted to the isolated local stack"
  );
  test.setTimeout(120_000);

  const { userId, title, listingId, listingRow } = await sellerWithListing(page);
  try {
    const photosAtCreation = (await listingRow()).listing_images.map((i) => i.url).sort();
    expect(photosAtCreation.length).toBeGreaterThan(0);

    // Two tabs open the same listing at the same version.
    await page.goto(`/listings/${listingId}/edit`);
    const stale = await context.newPage();
    await stale.goto(`/listings/${listingId}/edit`);
    await expect(stale.getByLabel("Title")).toHaveValue(title);

    // The first tab saves, then saves again from the same form.
    await page.getByLabel("Asking price").fill("99.00");
    await save(page).click();
    await expect(page.getByText("Listing updated.")).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await listingRow()).price_cents).toBe(9900);
    await page.getByLabel("Asking price").fill("98.00");
    await save(page).click();
    await expect.poll(async () => (await listingRow()).price_cents).toBe(9800);
    await expect(page.getByText(/changed since you opened it/i)).toHaveCount(0);

    // The second tab still holds the version from before both saves.
    await stale.getByLabel("Title").fill(`${title} (stale tab)`);
    await save(stale).click();
    await expect(stale.getByText(/changed since you opened it/i)).toBeVisible({ timeout: 20_000 });
    const after = await listingRow();
    expect(after.title).toBe(title);
    expect(after.price_cents).toBe(9800);
    // Neither the saves nor the refused stale save touched the photos.
    expect(after.listing_images.map((i) => i.url).sort()).toEqual(photosAtCreation);
  } finally {
    await cleanupFixtureUser(userId);
  }
});

// R2-01: the edit commits but its answer is lost, and so is the first status
// check. The form must not claim nothing changed; it keeps the draft, and
// saving the same draft again recovers the committed edit instead of being
// refused as stale or applying it twice.
test("a listing save whose answer is lost is recovered, not reported as unchanged", async ({ page }) => {
  test.skip(
    process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation",
    "Listing edit fixtures are restricted to the isolated local stack"
  );
  test.setTimeout(120_000);

  const { userId, listingId, listingRow } = await sellerWithListing(page);
  try {
    await page.goto(`/listings/${listingId}/edit`);
    await page.getByLabel("Asking price").fill("97.00");

    let actionPosts = 0;
    await page.route(`**/listings/${listingId}/edit`, async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !request.headers()["next-action"] || actionPosts >= 2) {
        return route.continue();
      }
      actionPosts += 1;
      // The save reaches the server and commits; the status check doesn't.
      if (actionPosts === 1) await route.fetch();
      await route.abort("failed");
    });
    await save(page).click();

    await expect(page.getByText(/still can.t confirm whether that saved/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/nothing was changed/i)).toHaveCount(0);
    await expect(page.getByLabel("Asking price")).toHaveValue("97.00");
    await expect.poll(async () => (await listingRow()).price_cents).toBe(9700);
    const committed = (await listingRow()).updated_at;

    // Same draft, same request: the server replays the committed outcome.
    await page.unroute(`**/listings/${listingId}/edit`);
    await save(page).click();
    await expect(page.getByText("Listing updated.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/changed since you opened it/i)).toHaveCount(0);
    const after = await listingRow();
    expect(after.price_cents).toBe(9700);
    expect(after.updated_at).toBe(committed);

    // The form now holds the new version, so a fresh edit saves normally.
    await page.getByLabel("Asking price").fill("96.00");
    await save(page).click();
    await expect.poll(async () => (await listingRow()).price_cents).toBe(9600);
    await expect(page.getByText(/changed since you opened it/i)).toHaveCount(0);
  } finally {
    await cleanupFixtureUser(userId);
  }
});

// The edit commits, its answer and the status check are both lost, and the
// seller then changes the draft before saving again. That is a new request
// from a version their own first save has already replaced: it must go
// through against the version that save produced, not be reported to them
// as a change made in another tab.
test("a changed draft saved after an unconfirmed save isn't refused as someone else's change", async ({ page }) => {
  test.skip(
    process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation",
    "Listing edit fixtures are restricted to the isolated local stack"
  );
  test.setTimeout(120_000);

  const { userId, title, listingId, listingRow } = await sellerWithListing(page);
  try {
    await page.goto(`/listings/${listingId}/edit`);
    await page.getByLabel("Asking price").fill("97.00");

    let actionPosts = 0;
    await page.route(`**/listings/${listingId}/edit`, async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !request.headers()["next-action"] || actionPosts >= 2) {
        return route.continue();
      }
      actionPosts += 1;
      // The save reaches the server and commits; the status check doesn't.
      if (actionPosts === 1) await route.fetch();
      await route.abort("failed");
    });
    await save(page).click();

    await expect(page.getByText(/still can.t confirm whether that saved/i)).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await listingRow()).price_cents).toBe(9700);
    const committed = (await listingRow()).updated_at;

    // A different draft: a new request, sent once the first is known saved.
    await page.unroute(`**/listings/${listingId}/edit`);
    await page.getByLabel("Asking price").fill("96.00");
    await save(page).click();
    await expect(page.getByText("Listing updated.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/changed since you opened it/i)).toHaveCount(0);
    await expect(page.getByText(/earlier save/i)).toHaveCount(0);
    const after = await listingRow();
    expect(after.price_cents).toBe(9600);
    expect(after.title).toBe(title);
    expect(Date.parse(after.updated_at)).toBeGreaterThan(Date.parse(committed));

    // The form holds the newest version, so the next edit saves normally.
    await page.getByLabel("Asking price").fill("95.00");
    await save(page).click();
    await expect.poll(async () => (await listingRow()).price_cents).toBe(9500);
    await expect(page.getByText(/changed since you opened it/i)).toHaveCount(0);
  } finally {
    await cleanupFixtureUser(userId);
  }
});

test("an edit can't be typed before the form is live, so hydration never resets it", async ({ page }) => {
  test.skip(
    process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation",
    "Listing edit fixtures are restricted to the isolated local stack"
  );
  test.setTimeout(120_000);

  const { userId, listingId } = await sellerWithListing(page);
  let release!: () => void;
  const scripts = new Promise<void>((resolve) => { release = resolve; });
  try {
    // Hold the client code: the form is server-rendered but not yet live.
    await page.route("**/_next/static/**/*.js", async (route) => {
      await scripts;
      await route.continue();
    });
    await page.goto(`/listings/${listingId}/edit`, { waitUntil: "commit" });
    const price = page.getByLabel("Asking price");
    // Typed now, React would reset this controlled field to the saved price
    // when it hydrates (CI run 37172858009: 97.00 became 125.00).
    await expect(price).toBeDisabled();
    release();
    await expect(price).toBeEnabled();
    await price.fill("97.00");
    await expect(price).toHaveValue("97.00");
    await expect(page.locator(".saverow").getByRole("button", { name: "Save changes" })).toBeEnabled();
  } finally {
    release();
    await cleanupFixtureUser(userId);
  }
});
