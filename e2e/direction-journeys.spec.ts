import { expect, test, type Browser, type Page } from "@playwright/test";

import { fixtureAdmin } from "./fixtures";
import {
  addCar,
  cleanupE2eUsers,
  enableSellerPayouts,
  makeUser,
  publishListing,
  signUp,
} from "./helpers";

/**
 * The six acceptance journeys from `docs/plans/2026-09-direction-build-plan.md`.
 *
 * Each workstream has its own tests. These are the ones that only pass if
 * several workstreams agree — the seams nobody owns, which is exactly where
 * a change lands that is individually correct and collectively wrong.
 *
 * They run against the isolated local stack only: every one of them writes
 * fixture accounts, and two of them reach past the UI with the service role
 * to put an order in a state the checkout would otherwise take ten minutes
 * to reach.
 */

test.describe.configure({ mode: "serial" });

test.beforeEach(() => {
  test.skip(
    process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation",
    "Acceptance journeys create fixture accounts — isolated local stack only"
  );
});

test.afterAll(async () => {
  await cleanupE2eUsers();
});

/** A one-pixel PNG, for the surfaces where a photo is now mandatory (W-2). */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * A second browser context, rather than clearing cookies on the first.
 * Signing up while a stale session is still around lands on /home instead
 * of /onboarding, and the failure reads as a mysterious timeout.
 */
async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

async function attachPhoto(page: Page) {
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "part.png",
    mimeType: "image/png",
    buffer: PIXEL,
  });
}

// ---------------------------------------------------------------------------
// 1. Replace a part and list the old one (WS2)
// ---------------------------------------------------------------------------
// The first loop of the product, and the one that used to destroy its own
// evidence: the old part's row was deleted, so the listing released off it
// pointed at nothing and an earlier update named a part the sheet denied.
test("journey 1 — replacing a part keeps the old record, and listing it keeps both", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const user = makeUser("j1", Date.now());
  await signUp(page, user);
  await enableSellerPayouts(user.username);
  await addCar(page, "Journey One Car");
  const editUrl = page.url();

  const editor = page.locator("section").filter({ hasText: "The build — seed the lines" });
  await editor.getByRole("button", { name: "+ Add a line manually" }).click();
  const rows = editor.locator(".modrow:not(.modrow--off)");
  await rows.nth(0).getByLabel("Brand").fill("KW");
  await rows.nth(0).getByLabel("Product").fill("V3 coilovers");
  await editor.getByRole("button", { name: "Save the build" }).click();
  await expect(editor.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  // Replace: the old line is marked off and a new one takes its position.
  await page.reload();
  await editor.locator(".modrow:not(.modrow--off)").first().getByRole("button", { name: "Replace" }).click();
  const fresh = editor.locator(".modrow:not(.modrow--off)").first();
  await fresh.getByLabel("Brand").fill("Öhlins");
  await fresh.getByLabel("Product").fill("Road & Track");
  await editor.getByRole("button", { name: "Save the build" }).click();
  await expect(editor.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Came off this car")).toBeVisible();
  // The old part is a record now — read-only text under "Came off this car".
  await expect(editor.locator(".modrow--off")).toContainText("KW V3 coilovers");
  // The new one is a live row in its position, so it is an input value.
  const replacement = editor.locator(".modrow:not(.modrow--off)").first();
  await expect(replacement.getByLabel("Brand")).toHaveValue("Öhlins");
  await expect(replacement.getByLabel("Product")).toHaveValue("Road & Track");

  // The removed row keeps its id — the contract behind "came off this car".
  const admin = fixtureAdmin();
  const { data: mods } = await admin
    .from("mod_items")
    .select("id, status, brand, product, removed_at")
    .eq("brand", "KW");
  const removed = (mods ?? []).find((m) => m.product === "V3 coilovers");
  expect(removed?.status).toBe("removed");
  expect(removed?.removed_at).not.toBeNull();

  // Abandoning the sell form loses nothing: the part is already off the sheet.
  await editor
    .locator(".modrow--off")
    .filter({ hasText: "KW V3 coilovers" })
    .getByRole("button", { name: "List it" })
    .click();
  await page.waitForURL(/\/sell/, { timeout: 30_000 });
  await page.goto(editUrl);
  await expect(editor.locator(".modrow--off")).toContainText("KW V3 coilovers");
});

// ---------------------------------------------------------------------------
// 2. That listing reaches followers once (WS3)
// ---------------------------------------------------------------------------
// Following the seller AND the car is the ordinary case, not an edge case:
// you follow the build you like and the person who made it. The feed union
// has to dedupe, or the same part appears twice in one scroll.
test("journey 2 — following the seller and the car gives one card, not two", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const seller = makeUser("j2s", stamp);
  const follower = makeUser("j2f", stamp);
  const title = `Journey two manifold ${stamp}`;
  const admin = fixtureAdmin();

  const sellerPage = await freshPage(browser);
  await signUp(sellerPage, seller);
  await enableSellerPayouts(seller.username);
  await addCar(sellerPage, "Journey Two Car");

  const { data: sellerProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("username", seller.username)
    .single();
  const { data: car } = await admin
    .from("cars")
    .select("id")
    .eq("owner_id", sellerProfile!.id)
    .single();
  // Public through the service role: the car's own visibility UI is WS12's
  // test, not this one's.
  const madePublic = await admin.from("cars").update({ is_public: true }).eq("id", car!.id);
  expect(madePublic.error).toBeNull();

  const listingPath = await publishListing(sellerPage, { title, price: "250", shipping: "0" });
  const listingId = listingPath.split("/").pop()!;
  const sourced = await admin
    .from("listings")
    .update({ source_car_id: car!.id })
    .eq("id", listingId);
  expect(sourced.error).toBeNull();

  const followerPage = await freshPage(browser);
  await signUp(followerPage, follower);
  const { data: followerProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("username", follower.username)
    .single();
  // Both edges at once — the ordinary case, and the point of the test.
  const follows = await admin.from("follows").insert([
    { follower_id: followerProfile!.id, target_type: "profile", target_id: sellerProfile!.id },
    { follower_id: followerProfile!.id, target_type: "car", target_id: car!.id },
  ]);
  expect(follows.error).toBeNull();

  await followerPage.goto("/home");
  await expect(followerPage.getByText(title)).toHaveCount(1, { timeout: 30_000 });
});

// ---------------------------------------------------------------------------
// 3. A stranger finds it signed out (WS1, WS8, WS9)
// ---------------------------------------------------------------------------
// The signed-out parts gate came from a retired PRD. Lifting it means five
// separate places agreeing; four out of five is a product that looks broken
// in exactly one spot.
test("journey 3 — a signed-out visitor finds a part four different ways", async ({ browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const seller = makeUser("j3", stamp);
  const title = `Journey three intercooler ${stamp}`;
  const admin = fixtureAdmin();

  const sellerPage = await freshPage(browser);
  await signUp(sellerPage, seller);
  await enableSellerPayouts(seller.username);
  await addCar(sellerPage, "Journey Three Car");
  await publishListing(sellerPage, { title, price: "400", shipping: "0" });

  // A private source car: named everywhere, linked nowhere.
  const { data: sellerProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("username", seller.username)
    .single();
  const { data: car } = await admin
    .from("cars")
    .select("id")
    .eq("owner_id", sellerProfile!.id)
    .single();
  await admin.from("cars").update({ is_public: false }).eq("id", car!.id);
  await admin.from("listings").update({ source_car_id: car!.id }).eq("seller_id", sellerProfile!.id);

  const guest = await freshPage(browser);

  // (a) the Parts segment of Explore
  await guest.goto("/explore?tab=parts");
  await expect(guest.getByText(title)).toBeVisible({ timeout: 30_000 });

  // (b) search results
  await guest.goto(`/explore?q=${encodeURIComponent(`intercooler ${stamp}`)}`);
  await expect(guest.getByText(title).first()).toBeVisible({ timeout: 30_000 });

  // (c) suggestions — the endpoint reads no session at all
  const suggest = await guest.request.get(
    `/api/explore/suggest?q=${encodeURIComponent(`intercooler ${stamp}`)}`
  );
  expect(suggest.ok()).toBeTruthy();
  expect(JSON.stringify(await suggest.json())).toContain("Journey three intercooler");

  // (d) the item page — the private car is named, and is not a link
  await guest.goto("/explore?tab=parts");
  await guest.getByText(title).first().click();
  await expect(guest).toHaveURL(/\/listings\//, { timeout: 30_000 });
  const carMention = guest.getByText("Journey Three Car").first();
  if (await carMention.count()) {
    await expect(carMention.locator("xpath=ancestor::a")).toHaveCount(0);
  }
});

// ---------------------------------------------------------------------------
// 4. It sells and the store shows it (WS10, WS14a)
// ---------------------------------------------------------------------------
// The store is the only public surface that shows SOLD, which is why it runs
// its own query — and the only one where "which statuses" must come from who
// is looking rather than from the URL.
test("journey 4 — a sold part stays in the store, and drafts never leak", async ({ browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const seller = makeUser("j4", stamp);
  const soldTitle = `Journey four wing ${stamp}`;
  const draftTitle = `Journey four secret draft ${stamp}`;
  const admin = fixtureAdmin();

  const sellerPage = await freshPage(browser);
  await signUp(sellerPage, seller);
  await enableSellerPayouts(seller.username);
  await addCar(sellerPage, "Journey Four Car");
  const soldPath = await publishListing(sellerPage, { title: soldTitle, price: "900", shipping: "0" });

  const { data: sellerProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("username", seller.username)
    .single();
  const sold = await admin
    .from("listings")
    .update({ status: "sold" })
    .eq("id", soldPath.split("/").pop()!);
  expect(sold.error).toBeNull();
  const draft = await admin
    .from("listings")
    .insert({
      seller_id: sellerProfile!.id,
      title: draftTitle,
      category: "exterior-body",
      subcategory: "aero",
      price_cents: 12345,
      currency: "USD",
      status: "draft",
    })
    .select("id")
    .single();
  expect(draft.error).toBeNull();

  const guest = await freshPage(browser);
  // The tab key is `view=` — the old keys are aliases of it (P-3).
  const store = `/u/${seller.username}?view=parts`;

  // The store opens on what is FOR SALE — that is what a visitor came for,
  // and it is the number on the Parts tab. A sold part is one tap away under
  // Sold and under All, and never under the default.
  await guest.goto(store);
  await expect(guest.getByRole("group", { name: /which parts to show/i })).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByText(soldTitle)).toHaveCount(0);
  await guest.getByRole("link", { name: "Sold", exact: true }).click();
  await expect(guest.getByText(soldTitle)).toBeVisible({ timeout: 30_000 });
  // A sold part on the store is a record, not an offer.
  await expect(guest.getByRole("button", { name: /add .* to cart|add to cart/i })).toHaveCount(0);
  await guest.goto(`${store}&status=all`);
  await expect(guest.getByText(soldTitle)).toBeVisible({ timeout: 30_000 });

  // The URL cannot widen what a stranger may see — not with a status, and
  // not with the owner's own worklist tab.
  for (const attack of ["draft", "hidden", "paused"]) {
    await guest.goto(`${store}&status=${attack}`);
    await expect(guest.getByRole("group", { name: /which parts to show/i })).toBeVisible({ timeout: 30_000 });
    await expect(guest.getByText(draftTitle)).toHaveCount(0);
  }
  await expect(guest.getByRole("link", { name: "Not live", exact: true })).toHaveCount(0);

  // And the sold part is unbuyable rather than merely unlabelled.
  await guest.goto(soldPath);
  await expect(guest.getByRole("button", { name: /add to cart|buy it now/i })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 5. Quick post without losing a long draft (WS14a) — release-blocking
// ---------------------------------------------------------------------------
// The database guard proves the row survives. This proves the member sees it
// survive: the handoff link reads "Continue your draft" and opens the draft
// with its text intact.
test("journey 5 — a quick post leaves a half-written update exactly where it was", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await freshPage(browser);
  const stamp = Date.now();
  const user = makeUser("j5", stamp);
  const draftTitle = `The head is off ${stamp}`;
  const draftText = "Two thousand words about a cylinder head, and I am not finished.";

  await signUp(page, user);
  await addCar(page, "Journey Five Car");
  const carId = page.url().match(/\/garage\/([\w-]+)\/edit/)![1];

  // A long update, left as a draft.
  await page.goto(`/garage/${carId}/update/new`);
  await page.getByLabel(/title/i).first().fill(draftTitle);
  await page.locator(".ProseMirror").first().click();
  await page.keyboard.type(draftText);
  await expect(page.getByText(/saved — only you can see it/i)).toBeVisible({ timeout: 20_000 });

  // A quick post about something else entirely.
  await page.goto("/home");
  const quick = page.locator(".composerlite");
  await quick.getByLabel(/what's new/i).fill("New wheels turned up.");
  await attachPhoto(page);
  await expect(quick.getByRole("button", { name: /photos \(1\)/i })).toBeVisible({
    timeout: 30_000,
  });
  await quick.getByRole("button", { name: /^post$/i }).click();
  await page.waitForURL(/\/cars\/[\w-]+\/activity\/|\/posts\//, { timeout: 30_000 });
  // Twice on the page, and both are the point: postHeadline() put the
  // member's own first line in the heading rather than inventing one.
  await expect(page.getByRole("heading", { name: "New wheels turned up." })).toBeVisible();

  // THE contract: the draft is still a draft, and still says what it said.
  await page.goto("/home");
  await expect(page.locator(".composerlite").getByRole("link", { name: /continue your draft/i })).toBeVisible();
  await page.goto(`/garage/${carId}/update/new`);
  await expect(page.getByLabel(/title/i).first()).toHaveValue(draftTitle);
  await expect(page.getByText(draftText)).toBeVisible();

  // And both posts exist — the quick one published, the long one not.
  const admin = fixtureAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("username", user.username)
    .single();
  const { data: posts } = await admin
    .from("activity_posts")
    .select("id, title, published_at")
    .eq("author_id", profile!.id);
  expect(posts).toHaveLength(2);
  expect(posts!.filter((p) => p.published_at).map((p) => p.title)).toEqual([null]);
  expect(posts!.filter((p) => !p.published_at).map((p) => p.title)).toEqual([draftTitle]);
});

// ---------------------------------------------------------------------------
// 6. The buyer finishes the loop (WS4, WS8, WS11)
// ---------------------------------------------------------------------------
// The loop that was a dead end: the part arrived, went on the car, and the
// build sheet never heard. The order is built with the service role — the
// checkout itself is golden-path's job, not this test's.
test("journey 6 — a delivered order becomes a line on the build sheet, once", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const buyer = makeUser("j6b", stamp);
  const seller = makeUser("j6s", stamp);
  const partTitle = `Journey six turbo ${stamp}`;
  const admin = fixtureAdmin();

  const sellerPage = await freshPage(browser);
  await signUp(sellerPage, seller);
  await enableSellerPayouts(seller.username);
  await addCar(sellerPage, "Journey Six Seller Car");
  const listingPath = await publishListing(sellerPage, {
    title: partTitle,
    price: "1500",
    shipping: "0",
  });
  const listingId = listingPath.split("/").pop()!;

  const buyerPage = await freshPage(browser);
  await signUp(buyerPage, buyer);
  await addCar(buyerPage, "Journey Six Buyer Car");

  const [{ data: sellerProfile }, { data: buyerProfile }] = await Promise.all([
    admin.from("profiles").select("id").eq("username", seller.username).single(),
    admin.from("profiles").select("id").eq("username", buyer.username).single(),
  ]);
  const { data: listing } = await admin
    .from("listings")
    .select("price_cents, category, subcategory")
    .eq("id", listingId)
    .single();

  // The order is built with the service role: reaching "delivered" through
  // checkout and dispatch is golden-path's job, not this test's.
  const order = await admin
    .from("orders")
    .insert({
      buyer_id: buyerProfile!.id,
      seller_id: sellerProfile!.id,
      status: "delivered",
      subtotal_cents: listing!.price_cents,
      platform_fee_cents: 0,
      shipping_cents: 0,
      total_cents: listing!.price_cents,
      currency: "USD",
    })
    .select("id")
    .single();
  expect(order.error).toBeNull();
  const item = await admin
    .from("order_items")
    .insert({
      order_id: order.data!.id,
      listing_id: listingId,
      quantity: 1,
      price_cents: listing!.price_cents,
      title: partTitle,
      // The frozen record the build line is built from — never the live
      // listing, which the seller may have edited since.
      commercial_snapshot: {
        listing: {
          id: listingId,
          title: partTitle,
          category: listing!.category,
          subcategory: listing!.subcategory,
        },
        part: { part_number: null },
        seller: { username: seller.username },
      },
    })
    .select("id")
    .single();
  expect(item.error).toBeNull();

  await buyerPage.goto(`/orders/${order.data!.id}`);
  // One car in the garage, so there is nothing to choose: the button names
  // the car and adds it. (With several cars it opens a picker instead.)
  const add = buyerPage.getByRole("button", { name: "Add to Journey Six Buyer Car" }).first();
  await expect(add).toBeVisible({ timeout: 30_000 });
  await add.click();
  await expect(buyerPage.getByRole("status").filter({ hasText: /added to your build/i })).toBeVisible({
    timeout: 30_000,
  });

  // A second tap adds nothing — idempotent through source_order_item_id —
  // and says so, rather than erroring or pretending it was added again.
  await buyerPage.reload();
  const again = buyerPage.getByRole("button", { name: "Add to Journey Six Buyer Car" }).first();
  await expect(again).toBeVisible({ timeout: 30_000 });
  await again.click();
  await expect(buyerPage.getByRole("status").filter({ hasText: /already on this car/i })).toBeVisible({
    timeout: 30_000,
  });

  const { data: buyerCar } = await admin
    .from("cars")
    .select("id")
    .eq("owner_id", buyerProfile!.id)
    .single();
  const { data: lines } = await admin
    .from("mod_items")
    .select("id, source_order_item_id")
    .eq("car_id", buyerCar!.id);
  expect((lines ?? []).filter((l) => l.source_order_item_id === item.data!.id)).toHaveLength(1);
});
