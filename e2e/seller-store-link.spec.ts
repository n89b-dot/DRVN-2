import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

/**
 * R2-06. The listing page linked the seller as `/u/<name>?tab=parts`, but the
 * profile reads `?view=`, so a PERSONAL seller's store opened on Overview (a
 * shop opens on Parts by default, which hid the bug). The seller here is a
 * plain member on purpose.
 */

async function expectStore(page: Page, title: string) {
  const parts = page.getByRole("tablist", { name: "Profile sections" }).getByRole("tab", { name: /^Parts/ });
  await expect(parts).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  const panel = page.locator("#panel-parts");
  await expect(panel).toBeVisible();
  await expect(panel.getByText(title)).toBeVisible({ timeout: 30_000 });
}

test("a personal seller's link from a listing opens their store on Parts", async ({ page }) => {
  test.setTimeout(120_000);
  const admin = fixtureAdmin();
  const token = randomUUID().replaceAll("-", "").slice(0, 12);
  const created = await admin.auth.admin.createUser({ email: `e2e-store-link-${token}@drvn.test`, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("Missing seller fixture user");
  const sellerId = created.data.user.id;
  try {
    const username = `storelink${token}`;
    const displayName = `Store Link ${token}`;
    const named = await admin
      .from("profiles")
      .update({ username, display_name: displayName })
      .eq("id", sellerId)
      .select("profile_type")
      .single();
    if (named.error) throw named.error;
    // The regression only shows on a member's profile — a shop defaults to Parts.
    expect(named.data.profile_type).not.toBe("shop");

    const title = `Store link brake set ${token}`;
    const listing = await admin
      .from("listings")
      .insert({ seller_id: sellerId, title, category: "performance", price_cents: 10000, shipping_cents: 0, currency: "USD", status: "active" })
      .select("id")
      .single();
    if (listing.error) throw listing.error;

    await page.goto(`/listings/${listing.data.id}`);
    const sellerLink = page.locator("a.pdp__seller");
    await expect(sellerLink).toContainText(displayName, { timeout: 30_000 });
    await expect(sellerLink).toHaveAttribute("href", `/u/${username}?view=parts`);
    await sellerLink.click();
    await page.waitForURL(new RegExp(`/u/${username}\\?view=parts$`));
    await expectStore(page, title);

    // Links built with the old key are already out in the world.
    await page.goto(`/u/${username}?tab=parts`);
    await expectStore(page, title);
  } finally {
    await cleanupFixtureUser(sellerId);
  }
});
