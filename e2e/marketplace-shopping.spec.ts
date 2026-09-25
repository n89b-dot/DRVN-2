import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { assertIsolatedTestTarget } from "../tests/support/test-target";

assertIsolatedTestTarget({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, projectRef: process.env.E2E_TEST_PROJECT_REF });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const stamp = Date.now();
const prefix = `ShoppingJourney ${stamp}`;
const email = `shopping-buyer-${stamp}@example.test`;
const password = "shopping-fixture-password-only";
let seller = "", buyer = "", primary = "", sourceSlug = "";
let bmw = "", toyota = "";
const createdMakes: number[] = [], createdModels: number[] = [];
const primaryTitle = `${prefix} BMW turbo assembly with manifold, bracket and all mounting hardware`;
async function identity(make: string, model: string) {
  const knownMake = await admin.from("catalog_makes").select("id").eq("name", make).maybeSingle().throwOnError();
  const makeId = knownMake.data?.id ?? (await admin.from("catalog_makes").insert({ name: make }).select("id").single().throwOnError()).data.id;
  if (!knownMake.data) createdMakes.push(makeId);
  const knownModel = await admin.from("catalog_models").select("id").eq("make_id", makeId).eq("name", model).maybeSingle().throwOnError();
  const modelId = knownModel.data?.id ?? (await admin.from("catalog_models").insert({ make_id: makeId, name: model }).select("id").single().throwOnError()).data.id;
  if (!knownModel.data) createdModels.push(modelId);
  return { make, model, catalog_make_id: makeId, catalog_model_id: modelId };
}
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email); await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click(); await page.waitForURL(/\/home/);
}
test.beforeAll(async () => {
  const s = await admin.auth.admin.createUser({ email: `shopping-seller-${stamp}@example.test`, password, email_confirm: true });
  if (s.error) throw s.error; seller = s.data.user.id;
  const b = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (b.error) throw b.error; buyer = b.data.user.id;
  for (const [id, name] of [[seller, "seller"], [buyer, "buyer"]]) await admin.from("profiles").update({ username: `shop${name}${stamp}`, display_name: `Shopping ${name}` }).eq("id", id).throwOnError();
  const first = await identity("BMW", "330i"), second = await identity("Toyota", "Supra");
  bmw = `${first.catalog_make_id}-${first.catalog_model_id}`; toyota = `${second.catalog_make_id}-${second.catalog_model_id}`;
  sourceSlug = `shopping-source-${stamp}`;
  const source = await admin.from("cars").insert({ owner_id: seller, name: "Source BMW build", slug: sourceSlug, ...first, year: 2018, is_public: true }).select("id").single().throwOnError();
  await admin.from("cars").insert([
    { owner_id: buyer, name: "My BMW", slug: `shopping-bmw-${stamp}`, ...first, year: 2018, is_public: false },
    { owner_id: buyer, name: "My Toyota", slug: `shopping-toyota-${stamp}`, ...second, year: 2019, is_public: false },
  ]).throwOnError();
  const parts = await admin.from("listings").insert([
    { seller_id: seller, title: primaryTitle, part_number: `MKT-${stamp}-A`, category: "performance", subcategory: "turbo", price_cents: 45000, shipping_cents: 1500, shipping_mode: "flat", condition: "used", location: "New York", source_car_id: source.data.id, status: "active", currency: "USD" },
    { seller_id: seller, title: `${prefix} Toyota intake`, category: "performance", subcategory: "intake", price_cents: 22000, shipping_cents: 0, shipping_mode: "pickup_only", allows_collection: true, condition: "used", status: "active", currency: "USD" },
    { seller_id: seller, title: `${prefix} sold part`, category: "performance", price_cents: 10000, status: "sold", currency: "USD" },
  ].map(part => ({ shipping_mode: "flat", shipping_cents: 0, allows_collection: false, ...part }))).select("id,title").throwOnError();
  primary = parts.data.find(p => p.title === primaryTitle)!.id;
  const other = parts.data.find(p => p.title.endsWith("Toyota intake"))!.id;
  await admin.from("listing_fitments").insert([
    { listing_id: primary, make: first.make, model: first.model, year_start: 2017, year_end: 2020 },
    { listing_id: other, make: second.make, model: second.model, year_start: 2018, year_end: 2021 },
  ]).throwOnError();
});
test.afterAll(async () => {
  for (const id of [buyer, seller]) {
    if (!id) continue;
    await admin.from("listings").delete().eq("seller_id", id).throwOnError();
    await admin.from("cars").delete().eq("owner_id", id).throwOnError();
    const deleted = await admin.auth.admin.deleteUser(id); if (deleted.error) throw deleted.error;
  }
  if (createdModels.length) await admin.from("catalog_models").delete().in("id", createdModels).throwOnError();
  if (createdMakes.length) await admin.from("catalog_makes").delete().in("id", createdMakes).throwOnError();
});

test("guest exact identifier, complete card facts, detail and source-build return", async ({ page }) => {
  const path = `/marketplace/performance/turbo?q=MKT${stamp}A&min=400&max=500&sort=price_asc`;
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "1 part found" })).toBeVisible();
  const card = page.locator("article.marketplace-card").first();
  await expect(card.getByText(primaryTitle, { exact: true })).toBeVisible();
  await expect(card.getByText("No photo provided", { exact: true })).toBeVisible();
  await expect(card.getByText(/\+ \$15 shipping/)).toBeVisible();
  await card.locator("a.marketplace-card__link").click();
  await expect(page.getByRole("heading", { name: primaryTitle, exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("from")).toBe(path);
  await page.locator(`a[href^="/cars/${sourceSlug}?"]`).click();
  await expect(page.getByRole("link", { name: /Back to the part/ })).toBeVisible();
  await page.getByRole("link", { name: /Back to the part/ }).click();
  await page.getByRole("navigation", { name: "Return to results" }).getByRole("link").click();
  await expect(page).toHaveURL(path);
});

test("guest chooses a vehicle and unknown years stay uncertain", async ({ page }) => {
  await page.goto(`/marketplace?q=${prefix}`);
  await page.getByRole("button", { name: /Choose vehicle/ }).click();
  const sheet = page.getByRole("dialog", { name: "Choose a vehicle", exact: true });
  await sheet.getByRole("combobox", { name: /^Make/ }).fill("BMW");
  await sheet.getByRole("option", { name: "BMW", exact: true }).click();
  await sheet.getByRole("combobox", { name: /^Model/ }).fill("330i");
  await sheet.getByRole("option", { name: "330i", exact: true }).click();
  await sheet.getByRole("button", { name: /Use vehicle/ }).click();
  await expect(page.getByRole("heading", { name: "1 part found" })).toBeVisible();
  await expect(page.locator(".marketplace-card").getByText(/year needed/i)).toBeVisible();
  await page.getByRole("button", { name: /Change vehicle/ }).click();
  await sheet.getByLabel("Vehicle year (optional)").fill("2018");
  await sheet.getByRole("button", { name: /Use vehicle/ }).click();
  await expect(page.locator(".marketplace-card").getByText(/Seller-stated vehicle match/i)).toBeVisible();
  await page.getByRole("button", { name: /Change vehicle/ }).click();
  await sheet.getByLabel("Vehicle year (optional)").fill("2022");
  await sheet.getByRole("button", { name: /Use vehicle/ }).click();
  await expect(page.getByRole("heading", { name: "0 parts found" })).toBeVisible();
  await page.getByRole("button", { name: /Clear vehicle/ }).click();
  await expect(page.getByRole("heading", { name: "2 parts found" })).toBeVisible();
});

test("a buyer with two garage cars can select each explicitly", async ({ page }) => {
  await login(page); await page.goto(`/marketplace?q=${prefix}&min=100&sort=price_asc`);
  for (const [label, vehicle, title] of [["My BMW", bmw, primaryTitle], ["My Toyota", toyota, `${prefix} Toyota intake`]]) {
    await page.getByRole("button", { name: /(Choose|Change) vehicle/ }).click();
    await page.getByRole("dialog", { name: "Choose a vehicle" }).getByLabel("Your garage").selectOption({ label });
    await expect(page.getByRole("heading", { name: "1 part found" })).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("vehicle")).toBe(vehicle);
    expect(new URL(page.url()).searchParams.get("min")).toBe("100");
    await expect(page.locator(".marketplace-card__title")).toHaveText(title);
  }
});

test("a leaf search saves all criteria, reopens from page one, and leaves alerts off", async ({ page }) => {
  await login(page);
  const path = `/marketplace/performance/turbo?q=${prefix}&vehicle=${bmw}&vyear=2018&condition=used&min=400&max=500&location=New+York&ymin=2010&ymax=2020&sort=price_desc`;
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "1 part found" })).toBeVisible();
  await page.getByRole("button", { name: "Save search", exact: true }).click();
  await expect(page.getByText(/Saved — find it under Saved/)).toBeVisible();
  const saved = await admin.from("saved_searches").select("params,alert").eq("user_id", buyer).single().throwOnError();
  expect(saved.data.alert).toBe(false); expect(saved.data.params._version).toBe("2");
  expect(saved.data.params.vyear).toBe("2018"); expect(saved.data.params.sort).toBe("price_desc");
  await page.goto("/saved");
  await page.getByRole("link", { name: `“${prefix}”`, exact: true }).click();
  await expect(page).toHaveURL(/\/marketplace\/performance\/turbo\?/);
  const restored = new URL(page.url());
  expect(restored.pathname).toBe("/marketplace/performance/turbo");
  for (const [key, value] of new URL(path, "http://localhost").searchParams) expect(restored.searchParams.get(key)).toBe(value);
  expect(restored.searchParams.has("page")).toBe(false);
});

test("guest Save resumes after sign-in without opening a different part", async ({ page }) => {
  await page.goto(`/marketplace?q=MKT${stamp}A&max=500`);
  await page.getByRole("button", { name: `Save ${primaryTitle}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /sign in to save/i });
  await dialog.getByRole("link", { name: /sign in/i }).click();
  await page.getByLabel(/email/i).fill(email); await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await expect(page).toHaveURL(new RegExp(`/listings/${primary}`));
  await expect(page.getByRole("button", { name: /^unsave/i }).first()).toBeVisible();
  expect(new URL(page.url()).searchParams.get("from")).toContain(`q=MKT${stamp}A`);
  const saves = await admin.from("saves").select("target_id").eq("user_id", buyer).eq("target_id", primary).throwOnError();
  expect(saves.data).toHaveLength(1);
  const alreadySaved = new URL(page.url()); alreadySaved.searchParams.set("action", "save");
  await page.goto(alreadySaved.toString());
  await expect.poll(() => new URL(page.url()).searchParams.has("action")).toBe(false);
  await page.getByRole("button", { name: /^unsave/i }).first().click();
  await expect(page.getByRole("button", { name: `Save ${primaryTitle}`, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: `Save ${primaryTitle}`, exact: true })).toBeVisible();
});

test("catalog failure is recoverable, and keyboard focus returns to the vehicle control", async ({ page }) => {
  await page.route("**/api/vehicles/catalog/makes", route => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto(`/marketplace?q=${prefix}`);
  const choose = page.getByRole("button", { name: /Choose vehicle/ });
  await choose.click();
  await expect(page.getByRole("alert").filter({ hasText: "Vehicle makes couldn’t be loaded." })).toBeVisible();
  await page.unroute("**/api/vehicles/catalog/makes");
  await page.getByRole("button", { name: /Retry vehicle list/ }).click();
  await page.getByRole("combobox", { name: /^Make/ }).fill("BMW");
  await expect(page.getByRole("option", { name: "BMW", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await expect(choose).toBeFocused();
});

for (const scheme of ["light", "dark"] as const) {
  test(`shopping accessibility, long titles and 200% text at 320px in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/marketplace?q=${prefix}`);
    await expect(page.locator(".marketplace-card").first()).toBeVisible();
    const audit = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`shopping-${scheme}-320.png`), fullPage: true });
    // Double computed text, including pixel-based design tokens. Root rem
    // scaling alone would leave those labels unchanged.
    await page.evaluate(() => {
      const text = [...document.querySelectorAll<HTMLElement>("main, main *")].map(element => {
        const style = getComputedStyle(element);
        return { element, size: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) };
      });
      for (const { element, size, line } of text) {
        element.style.setProperty("font-size", `${size * 2}px`, "important");
        if (Number.isFinite(line)) element.style.setProperty("line-height", `${line * 2}px`, "important");
      }
    });
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth > window.innerWidth,
      elements: [...document.querySelectorAll<HTMLElement>("main *")].filter(element => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.right > window.innerWidth + 1;
      }).map(element => `${element.tagName}.${element.className}`).slice(0, 12),
    }));
    expect(overflow, JSON.stringify(overflow.elements)).toMatchObject({ page: false });
    await expect(page.getByText(primaryTitle, { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`shopping-${scheme}-320-text200.png`), fullPage: true });
  });
}

test("guest Save search resumes the complete search after authentication", async ({ page }) => {
  await page.goto(`/marketplace/performance/intake?q=${encodeURIComponent(prefix)}&max=300&sort=price_asc`);
  await page.getByRole("button", { name: "Save search", exact: true }).click();
  await page.getByRole("dialog", { name: "Sign in to save this search", exact: true }).getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByLabel(/email/i).fill(email); await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await expect(page).toHaveURL(/\/marketplace\/performance\/intake\?/);
  await expect(page.getByText(/Saved — find it under Saved/)).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.has("action")).toBe(false);
  const saved = await admin.from("saved_searches").select("params,alert").eq("user_id", buyer).eq("params->>subcategory", "intake").single().throwOnError();
  expect(saved.data.alert).toBe(false); expect(saved.data.params.max).toBe("300"); expect(saved.data.params.sort).toBe("price_asc");
});

test("sold and unavailable saved parts stay understandable and can be removed", async ({ page }) => {
  const sold = await admin.from("listings").select("id").eq("seller_id", seller).eq("status", "sold").single().throwOnError();
  const unavailable = crypto.randomUUID();
  await admin.from("saves").insert([
    { user_id: buyer, target_type: "listing", target_id: sold.data.id },
    { user_id: buyer, target_type: "listing", target_id: unavailable },
  ]).throwOnError();
  await login(page); await page.goto("/saved");
  await expect(page.getByText(`${prefix} sold part`, { exact: true })).toBeVisible();
  await expect(page.getByText(/^sold$/i).first()).toBeVisible();
  const row = page.locator(".order").filter({ hasText: "Unavailable saved part" });
  await expect(page.getByText("This part is no longer publicly available.")).toBeVisible();
  await row.getByRole("button", { name: /Unsave/ }).click();
  await expect(page.getByText("Unavailable saved part", { exact: true })).toHaveCount(0);
});
