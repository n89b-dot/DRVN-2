import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { assertIsolatedTestTarget } from "../tests/support/test-target";

assertIsolatedTestTarget({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, projectRef: process.env.E2E_TEST_PROJECT_REF });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const title = `MarketplaceBrowse ${Date.now()}`;
const query = `q=${encodeURIComponent(title)}`;
// Fault injection: the page reads through marketplace_page (20261011110000),
// and marketplace_browse_rows is its fallback. Revoking both fails the read
// either way.
const PAGE_READ_FUNCTIONS = [
  "public.marketplace_page(text,text,text,text,text,text,integer,integer,text,integer,integer,integer,boolean,text,timestamp with time zone,integer,uuid,boolean,integer,integer,uuid[])",
  "public.marketplace_browse_rows(text,text,int,int,int,boolean,uuid)",
];
const email = `marketplace-browse-${Date.now()}@example.test`;
const password = "marketplace-browser-fixture-only";
let seller = "";

test.beforeAll(async () => {
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error) throw user.error;
  seller = user.data.user.id;
  await admin.from("profiles").update({ username: `mkt${Date.now()}`, display_name: "Marketplace test seller" }).eq("id", seller).throwOnError();
  await admin.from("listings").insert(Array.from({ length: 27 }, (_, i) => ({
    seller_id: seller, title: `${title} Part ${i + 1}`, category: i === 26 ? "brakes-suspension" : "engine",
    subcategory: i === 26 ? "coilovers" : i === 25 ? "drivetrain" : "internals",
    condition: "used", price_cents: 10000 + i * 100, shipping_cents: 1200, status: "active", currency: "USD",
  }))).throwOnError();
});

test.afterAll(async () => {
  if (!seller) return;
  await admin.from("listings").delete().eq("seller_id", seller).throwOnError();
  const result = await admin.auth.admin.deleteUser(seller);
  if (result.error) throw result.error;
});

test("result totals, category navigation and breadcrumbs preserve the search and budget", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/marketplace?${query}&min=100&max=500&sort=price_asc&page=2`);
  await expect(page.getByRole("heading", { name: "27 parts found" })).toBeVisible();
  await expect(page.getByText("Showing 25–27", { exact: true })).toBeVisible();
  // M-3: at this width categories are the sidebar's list. A category opens
  // to its part types in place, and both steps carry the search with them.
  await page.locator(".catside").getByRole("link", { name: /^Engine/ }).click();
  await expect(page).toHaveURL(/\/marketplace\/engine\?/);
  await page.locator(".catside").getByRole("link", { name: /Internals & Rotating Assembly/ }).click();
  await expect(page).toHaveURL(/\/marketplace\/engine\/internals\?/);
  expect(new URL(page.url()).searchParams.get("q")).toBe(title);
  expect(new URL(page.url()).searchParams.get("max")).toBe("500");
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  await expect(page.getByRole("heading", { name: "25 parts found" })).toBeVisible();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Engine", exact: true }).click();
  await expect(page.getByRole("heading", { name: "26 parts found" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("sort")).toBe("price_asc");
});

test("Cancel discards draft filters; sort only changes applied state", async ({ page }) => {
  // The filter panel is inline from 1024px (WS9, M-3), so the sheet and its
  // draft/Cancel semantics — which are what this test is about — live below
  // that width.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/marketplace/engine?${query}&min=100&max=500`);
  await page.getByRole("button", { name: "Filters, 1 active", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Filters", exact: true });
  await sheet.getByLabel("Maximum price", { exact: true }).fill("1");
  // With Reset/Apply in its footer the sheet has no close button; cancelling
  // is Escape (or the scrim), which drops the draft and returns focus.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Filters, 1 active", exact: true })).toBeFocused();
  expect(new URL(page.url()).searchParams.get("max")).toBe("500");
  await page.getByLabel("Sort results", { exact: true }).selectOption("price_desc");
  await expect(page).toHaveURL(/sort=price_desc/);
  expect(new URL(page.url()).searchParams.get("max")).toBe("500");
  await expect(page.getByRole("heading", { name: "26 parts found" })).toBeVisible();
  await page.getByRole("button", { name: "Filters, 1 active", exact: true }).click();
  await expect(sheet.getByLabel("Maximum price", { exact: true })).toHaveValue("500");
  await sheet.getByLabel("Maximum price", { exact: true }).fill("110");
  await sheet.getByRole("button", { name: /Apply filters/ }).click();
  await expect(page.getByRole("heading", { name: "11 parts found" })).toBeVisible();
  await page.getByRole("group", { name: "Active filters" }).getByRole("link", { name: "Clear filters", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("q")).toBe(title);
  expect(new URL(page.url()).searchParams.get("sort")).toBe("price_desc");
  await expect(page.getByRole("heading", { name: "26 parts found" })).toBeVisible();
});

test("legacy category URLs resolve to the canonical category with their context", async ({ page }) => {
  await page.goto(`/marketplace?category=interior&${query}&max=500`);
  await expect(page).toHaveURL(/\/marketplace\/interior-lighting\?/);
  expect(new URL(page.url()).searchParams.get("max")).toBe("500");
  await expect(page.getByRole("heading", { name: "0 parts found" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No parts match this search" })).toBeVisible();
});

test("Explore Parts uses the restored query and count", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByRole("button", { name: /log in|sign in/i }).click();
  await page.waitForURL(/\/home/);
  await page.goto(`/explore?tab=parts&${query}`);
  await expect(page.getByRole("heading", { name: "27 parts found" })).toBeVisible();
  await expect(page.locator("article.mcell").first()).toBeVisible();
  await page.goto(`/explore?tab=parts&${query}&min=100&max=500`);
  await page.getByRole("button", { name: /Filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filters", exact: true });
  await sheet.getByLabel("Maximum price", { exact: true }).fill("1");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await page.getByLabel("Sort results", { exact: true }).selectOption("price_desc");
  await expect(page).toHaveURL(/sort=price_desc/);
  expect(new URL(page.url()).searchParams.get("max")).toBe("500");
  await page.getByRole("button", { name: /Filters/ }).click();
  await expect(sheet.getByLabel("Maximum price", { exact: true })).toHaveValue("500");
  await sheet.getByRole("button", { name: /^\[?\s*Reset\s*\]?$/ }).click();
  await sheet.getByRole("button", { name: /Apply filters/ }).click();
  await expect(page.getByRole("heading", { name: "27 parts found" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("max")).toBeFalsy();
  expect(new URL(page.url()).searchParams.get("q")).toBe(title);
  expect(new URL(page.url()).searchParams.get("sort")).toBe("price_desc");
});

test("invalid draft prices explain the problem and Cancel restores a usable search", async ({ page }) => {
  // The filter panel is inline from 1024px (WS9, M-3), so the sheet and its
  // draft/Cancel semantics — which are what this test is about — live below
  // that width.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/marketplace/engine?${query}&min=100&max=500`);
  await page.getByRole("button", { name: "Filters, 1 active", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Filters", exact: true });
  const max = sheet.getByLabel("Maximum price", { exact: true });
  await max.fill("1");
  await sheet.getByRole("button", { name: /Apply filters/ }).click();
  expect(await max.evaluate((element: HTMLInputElement) => element.validationMessage)).toContain("Maximum price");
  expect(new URL(page.url()).searchParams.get("max")).toBe("500");
  await page.keyboard.press("Escape");
  await page.getByLabel("Search parts", { exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "26 parts found" })).toBeVisible();
});

for (const width of [320, 390, 768, 1440]) {
  test(`inventory stays legible and category access survives filtering at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/marketplace?${query}`);
    await expect(page.getByRole("heading", { name: "27 parts found" })).toBeVisible();
    const card = page.locator("article.marketplace-card").first();
    await expect(card).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    if (width < 640) {
      expect((await card.boundingBox())!.y).toBeLessThan(600);
      await page.getByRole("button", { name: /Browse categories/ }).click();
      const sheet = page.getByRole("dialog", { name: "Browse by category" });
      await sheet.getByRole("link", { name: /^Engine / }).click();
      await expect(page).toHaveURL(/\/marketplace\/engine\?/);
      expect(new URL(page.url()).searchParams.get("q")).toBe(title);
      await expect(page.getByRole("heading", { name: "26 parts found" })).toBeVisible();
      await expect(page.locator("article.marketplace-card").first()).toBeVisible();
    } else {
      await expect(page.getByRole("navigation", { name: "Browse by category", exact: true })).toBeVisible();
    }
    await page.screenshot({ path: test.info().outputPath(`marketplace-${width}.png`), fullPage: false });
  });
}

test("RPC failure shows Retry, retains context and recovers without a false zero count", async ({ page }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Fault injection is restricted to the disposable local database");
  const sql = (statement: string) => execFileSync("docker", ["exec", "supabase_db_DRVN_2", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", statement], { stdio: "pipe" });
  try {
    for (const signature of PAGE_READ_FUNCTIONS) sql(`revoke execute on function ${signature} from anon;`);
    await page.goto(`/marketplace/engine?${query}&max=500`);
    await expect(page.getByRole("heading", { name: "Parts couldn’t be loaded" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^0 parts/ })).toHaveCount(0);
  } finally {
    for (const signature of PAGE_READ_FUNCTIONS) sql(`grant execute on function ${signature} to anon;`);
  }
  await page.getByRole("button", { name: /Retry/ }).click();
  await expect(page.getByRole("heading", { name: "26 parts found" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("max")).toBe("500");
});

test("mobile empty and failed states remain distinct and usable", async ({ page }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Fault injection is restricted to the disposable local database");
  const sql = (statement: string) => execFileSync("docker", ["exec", "supabase_db_DRVN_2", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", statement], { stdio: "pipe" });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/marketplace/interior-lighting?${query}&max=500`);
    await expect(page.getByRole("heading", { name: "0 parts found" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No parts match this search" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await page.screenshot({ path: test.info().outputPath(`marketplace-empty-${width}.png`) });
    try {
      for (const signature of PAGE_READ_FUNCTIONS) sql(`revoke execute on function ${signature} from anon;`);
      await page.goto(`/marketplace/engine?${query}&max=500`);
      await expect(page.getByRole("heading", { name: "Parts couldn’t be loaded" })).toBeVisible();
      await expect(page.getByRole("heading", { name: /^0 parts/ })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      await page.screenshot({ path: test.info().outputPath(`marketplace-error-${width}.png`) });
    } finally {
      for (const signature of PAGE_READ_FUNCTIONS) sql(`grant execute on function ${signature} to anon;`);
    }
    await page.getByRole("button", { name: /Retry/ }).click();
    await expect(page.getByRole("heading", { name: "26 parts found" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("max")).toBe("500");
  }
});
