import { expect, test, type Page } from "@playwright/test";

import { fixtureAdmin } from "./fixtures";
import { addCar, cleanupE2eUsers, enableSellerPayouts, makeUser, signUp, type TestUser } from "./helpers";

/**
 * R-untested: the P0 requirements (docs/DRVN-PRD-2026-09.md) whose behaviour
 * only shows on a rendered page — what a member actually sees on their
 * garage, profile and the marketplace. Unit and component tests cover the
 * rest; each test here is named by its PRD id.
 */

test.beforeEach(() => {
  test.skip(
    process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation",
    "Creates fixture accounts — isolated local stack only"
  );
});

test.afterAll(async () => {
  await cleanupE2eUsers();
});

async function profileId(user: TestUser): Promise<string> {
  const { data, error } = await fixtureAdmin().from("profiles").select("id").eq("username", user.username).single();
  if (error) throw error;
  return data.id;
}

/** Cars inserted directly — the add-car form has its own spec. */
async function giveCars(ownerId: string, names: string[]) {
  const admin = fixtureAdmin();
  const ids: string[] = [];
  for (const [i, name] of names.entries()) {
    const { data, error } = await admin
      .from("cars")
      .insert({
        owner_id: ownerId,
        name,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}-${i}`,
        is_public: true,
        created_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    ids.push(data.id);
  }
  return ids;
}

async function newMember(page: Page, role: string) {
  const user = makeUser(role, Date.now());
  await signUp(page, user);
  return { user, id: await profileId(user) };
}

test("F-3 — Add your car on the landing page carries next=/garage into sign-up", async ({ page }) => {
  await page.goto("/");
  const add = page.getByRole("link", { name: "Add your car" }).first();
  await expect(add).toHaveAttribute("href", "/signup?next=%2Fgarage");
  await add.click();
  await expect(page).toHaveURL(/\/signup\?next=%2Fgarage$/);
  await expect(page.locator('form input[type="hidden"][name="next"]')).toHaveValue("/garage");
});

test("G-1 — the garage strip shows every car, main first, with All cars and one Add vehicle", async ({ page }) => {
  test.setTimeout(120_000);
  const { id } = await newMember(page, "switch");
  // Created oldest to newest; the oldest is made the main car.
  const [first, second, third] = await giveCars(id, ["Oldest Main", "Middle Car", "Newest Car"]);
  const set = await fixtureAdmin().from("profiles").update({ main_car_id: first }).eq("id", id);
  if (set.error) throw set.error;

  await page.goto("/garage");
  const strip = page.getByRole("group", { name: "Choose a car" });
  await expect(strip.getByRole("link")).toHaveText(["All cars", "Oldest Main", "Newest Car", "Middle Car"]);
  await expect(strip.getByRole("link", { name: "Oldest Main" })).toHaveAttribute("aria-current", "true");
  await expect(strip.getByRole("link", { name: "Newest Car" })).toHaveAttribute("href", `/garage?car=${third}`);
  await expect(strip.getByRole("link", { name: "Middle Car" })).toHaveAttribute("href", `/garage?car=${second}`);
  // One Add vehicle control on the whole page, not one per surface.
  await expect(page.getByRole("button", { name: /^add (a car|vehicle)$/i })).toHaveCount(1);
});

async function givePublicListing(sellerId: string, title: string, carId?: string) {
  const { data, error } = await fixtureAdmin()
    .from("listings")
    .insert({
      seller_id: sellerId,
      title,
      category: "performance",
      price_cents: 12000,
      shipping_cents: 0,
      currency: "USD",
      status: "active",
      ...(carId ? { source_car_id: carId } : {}),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

test("M-4 — the marketplace grid is four, three or two cards across by breakpoint", async ({ page }) => {
  test.setTimeout(120_000);
  const { id } = await newMember(page, "grid");
  await givePublicListing(id, "Grid fixture part");
  // The columns follow the grid's own width (a container query), so each
  // step is checked at a viewport that lands in it, with the width it got.
  for (const [width, columns] of [
    [1440, 4],
    [1024, 3],
    [768, 3],
    [390, 2],
    [360, 2],
    // The smallest supported phone keeps two across too.
    [320, 2],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/marketplace");
    const grid = page.getByRole("region", { name: "Parts for sale" }).or(page.locator(".marketplace-grid .mosaic")).first();
    await expect(grid).toBeVisible();
    const across = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(across, `cards across at ${width}px`).toBe(columns);
  }
});

test("P-2 and P-3 — a visitor gets Follow, Store and share, and the profile's five tabs; the owner also sees Saved", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const { user, id } = await newMember(page, "prof");
  const [carId] = await giveCars(id, ["Profile Car"]);
  await givePublicListing(id, "Profile fixture part", carId);

  const TABS = ["Overview", "Garage", "Updates", "Parts", "Reviews"];
  // Tab labels may carry a count after the name ("Parts 1").
  const expectTabs = (p: Page, names: string[]) =>
    expect(p.getByRole("tablist", { name: "Profile sections" }).getByRole("tab")).toHaveText(
      names.map((name) => new RegExp(`^${name}(\\s*\\d+)?$`))
    );

  // A signed-out visitor.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  try {
    await visitor.goto(`/u/${user.username}`);
    await expect(visitor.getByRole("button", { name: "Follow", exact: true })).toBeVisible();
    await expect(visitor.getByRole("link", { name: /^\W*Store\W*$/ })).toHaveAttribute(
      "href",
      `/u/${user.username}?view=parts`
    );
    await expect(visitor.getByRole("button", { name: "Share" })).toBeVisible();
    await expectTabs(visitor, TABS);
    // No Builds tab and no activity log (P-3).
    await expect(visitor.getByRole("tab", { name: /builds|activity/i })).toHaveCount(0);

    // Store opens the Parts tab, where the Store button itself steps aside.
    await visitor.getByRole("link", { name: /^\W*Store\W*$/ }).click();
    await expect(visitor).toHaveURL(new RegExp(`/u/${user.username}\\?view=parts$`));
    await expect(visitor.getByRole("tab", { name: /^Parts/ })).toHaveAttribute("aria-selected", "true");
    await expect(visitor.getByText("Profile fixture part").locator("visible=true").first()).toBeVisible();
  } finally {
    await visitorContext.close();
  }

  // The owner, on the same public address: no Follow for themselves, plus Saved.
  await page.goto(`/u/${user.username}`);
  await expect(page.getByRole("button", { name: "Follow", exact: true })).toHaveCount(0);
  await expectTabs(page, [...TABS, "Saved"]);
  await page.getByRole("tab", { name: "Saved" }).click();
  await expect(page.getByRole("link", { name: "Open Saved →" })).toHaveAttribute("href", "/saved");
});

test("G-2 — the focused car's cover has a gradient scrim, with only the car's own label on it", async ({ page }) => {
  test.setTimeout(120_000);
  const { id } = await newMember(page, "cover");
  const admin = fixtureAdmin();
  const path = `${id}/cover.png`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9kAAAAASUVORK5CYII=",
    "base64"
  );
  const upload = await admin.storage.from("car-images").upload(path, png, { contentType: "image/png" });
  if (upload.error) throw upload.error;
  try {
    const cover = admin.storage.from("car-images").getPublicUrl(path).data.publicUrl;
    const [carId] = await giveCars(id, ["Scrim Car"]);
    const set = await admin.from("cars").update({ cover_image_url: cover, year: 1993, make: "Mazda", model: "RX-7" }).eq("id", carId);
    if (set.error) throw set.error;

    await page.goto(`/garage?car=${carId}`);
    const focus = page.locator("section.carfocus");
    await expect(focus).toHaveClass(/carfocus--photo/);
    const scrim = await focus
      .locator(".carfocus__cover")
      .evaluate((el) => getComputedStyle(el, "::after").backgroundImage);
    expect(scrim).toContain("linear-gradient");
    // The photo itself carries no text: decorative, no caption.
    await expect(focus.locator(".carfocus__cover img")).toHaveAttribute("alt", "");
    await expect(focus.locator(".carfocus__cover")).toHaveText("");
    // What sits over it is the car's own label and the actions — no
    // free-form text (description, update copy) from the member.
    const body = focus.locator(".carfocus__body");
    await expect(body.locator(":scope > *")).toHaveCount(3);
    await expect(body.locator(":scope > .microlabel")).toHaveText(/^1993 Mazda RX-7$/i);
    await expect(body.locator(":scope > h1")).toHaveText("Scrim Car");
    await expect(body.locator(".carfocus__actions > *")).toHaveText(["Post update", "Edit the car", "View the build page →"]);
  } finally {
    await admin.storage.from("car-images").remove([path]);
  }
});

test("A-4 — List it saves the sheet, opens the sell form prefilled, keeps the part under Came off, and a linked row opens its listing", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { user, id } = await newMember(page, "listit");
  await enableSellerPayouts(user.username);
  await addCar(page, "List It Car");
  const editUrl = page.url();
  const admin = fixtureAdmin();
  const car = await admin.from("cars").select("id").eq("owner_id", id).single();
  if (car.error) throw car.error;
  const set = await admin.from("cars").update({ make: "Mazda", model: "RX-7", year: 1993 }).eq("id", car.data.id);
  if (set.error) throw set.error;

  const editor = page.locator("section").filter({ hasText: "The build — seed the lines" });
  await editor.getByRole("button", { name: "+ Add a line manually" }).click();
  const line = editor.locator(".modrow:not(.modrow--cols):not(.modrow--off)").first();
  await line.getByLabel("Brand").fill("Tein");
  await line.getByLabel("Product").fill("Flex Z coilovers");
  // A line the name can't place may ask about stock parts; that is not this test.
  const stock = line.getByRole("group", { name: /did stock parts come off/i });
  if (await stock.isVisible()) await stock.getByRole("button", { name: "Nothing came off" }).click();
  await editor.getByRole("button", { name: "Save the build" }).click();
  await expect(editor.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.reload();

  // Take it off and choose List it — with nothing else saved first.
  await editor.getByRole("button", { name: "Take Tein Flex Z coilovers off this car" }).click();
  await editor
    .getByRole("group", { name: "What happens to Tein Flex Z coilovers?" })
    .getByRole("button", { name: "List it" })
    .click();
  await page.waitForURL(/\/sell\?car=[^&]+&mod=[^&]+$/, { timeout: 30_000 });

  // The sheet was saved before the sell form opened.
  const mod = await admin.from("mod_items").select("id, status, removed_at").eq("car_id", car.data.id).eq("product", "Flex Z coilovers").single();
  if (mod.error) throw mod.error;
  expect(mod.data.status).toBe("removed");
  expect(new URL(page.url()).searchParams.get("mod")).toBe(mod.data.id);
  // Prefilled from the mod and the car.
  await expect(page.getByLabel("Title")).toHaveValue("Tein Flex Z coilovers");
  await expect(page.getByLabel("Brand")).toHaveValue("Tein");
  await expect(page.getByRole("combobox", { name: "Fitment 1 make" })).toHaveValue("Mazda");
  await expect(page.getByRole("combobox", { name: "Fitment 1 model" })).toHaveValue("RX-7");
  await expect(page.getByRole("textbox", { name: "Fitment 1 first year" })).toHaveValue("1993");
  await expect(page.getByRole("textbox", { name: "Fitment 1 last year" })).toHaveValue("1993");

  // Abandon the form: the part waits under Came off this car, with List it.
  await page.goto(editUrl);
  const cameOff = editor.locator(".modrow--off").filter({ hasText: "Tein Flex Z coilovers" });
  await expect(cameOff).toBeVisible();
  await expect(cameOff.getByRole("button", { name: "List it" })).toBeVisible();

  // Once the row has a listing — a draft counts — it opens that listing.
  const draft = await admin
    .from("listings")
    .insert({ seller_id: id, title: "Tein Flex Z coilovers", category: "performance", price_cents: 40000, shipping_cents: 0, currency: "USD", status: "draft", source_car_id: car.data.id })
    .select("id")
    .single();
  if (draft.error) throw draft.error;
  const link = await admin.from("mod_items").update({ linked_listing_id: draft.data.id }).eq("id", mod.data.id);
  if (link.error) throw link.error;
  await page.reload();
  await expect(cameOff.getByRole("button", { name: "List it" })).toHaveCount(0);
  await cameOff.getByRole("link", { name: /draft/i }).click();
  await page.waitForURL(new RegExp(`/listings/${draft.data.id}/edit`));
  // And the sell form's own address for the part goes to the same listing.
  await page.goto(`/sell?car=${car.data.id}&mod=${mod.data.id}`);
  await page.waitForURL(new RegExp(`/listings/${draft.data.id}/edit`));
});
