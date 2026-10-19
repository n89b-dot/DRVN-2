import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

/**
 * A5 price-drop suggestions. A live listing up a month, looked at 40 times,
 * with no offers, gets one suggested price from a rule (10% off, rounded
 * down to the dollar-five, never below the minimum). It opens the listing
 * editor with that price filled in, and nothing changes until the seller
 * saves.
 */
test("a listing that isn't moving gets a suggested price, filled in but not saved", async ({ page }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Agent fixtures are restricted to the isolated local stack");
  test.setTimeout(120_000);

  const admin = fixtureAdmin();
  const password = `AgentNudge-${randomUUID()}!`;
  const email = `e2e-agent-nudge-${randomUUID()}@drvn.test`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("Missing nudge seller");
  const sellerId = created.data.user.id;
  const db = new Client({ host: "127.0.0.1", port: 54322, user: "supabase_admin", password: "postgres", database: "postgres" });
  await db.connect();

  try {
    await admin.from("profiles").update({ username: `nudge${randomUUID().replaceAll("-", "").slice(0, 15)}` }).eq("id", sellerId);
    const invitationId = randomUUID();
    await admin.from("beta_invitations").insert({ id: invitationId, email_normalized: email, roles: ["buyer", "seller"], token_hash: createHash("sha256").update(randomUUID()).digest("hex"), expires_at: new Date(Date.now() + 3_600_000).toISOString(), consumed_at: new Date().toISOString(), consumed_by: sellerId });
    await admin.from("beta_memberships").insert({ user_id: sellerId, invitation_id: invitationId, email_normalized: email, roles: ["buyer", "seller"] });
    await db.query("update public.agent_beta_steps set open = true where step = 'seller'");

    const title = `Stale intake ${randomUUID().slice(0, 8)}`;
    const listing = await admin.from("listings").insert({ seller_id: sellerId, title, category: "performance", subcategory: "intake", condition: "used", price_cents: 25000, shipping_cents: 0, currency: "USD", status: "active" }).select("id").single().throwOnError();
    const listingId = listing.data!.id;
    await admin.from("listing_images").insert({ listing_id: listingId, url: "https://example.test/stale-intake.webp", position: 0 }).throwOnError();
    // A month up and looked at, as the clock and the view counter would leave it.
    await db.query("update public.listings set created_at = now() - interval '30 days', view_count = 40 where id = $1", [listingId]);

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);

    await page.goto("/agent");
    const worth = page.getByRole("region", { name: "Worth a look" });
    await expect(worth.getByText(title)).toBeVisible();
    await expect(worth.getByText("$250 → $225 · Up 30 days, 40 views, no offers.")).toBeVisible();

    await worth.getByRole("link", { name: "Review the price" }).click();
    await page.waitForURL(new RegExp(`/listings/${listingId}/edit\\?suggest=22500`));
    await expect(page.locator("#main").getByText("Suggested price: $225")).toBeVisible();
    await expect(page.locator("#main").getByLabel("Asking price")).toHaveValue(/^225(\.00)?$/);
    // Nothing changed: the listing still asks $250.
    const after = await admin.from("listings").select("price_cents").eq("id", listingId).single();
    expect(after.data?.price_cents).toBe(25000);
  } finally {
    await db.end();
    await cleanupFixtureUser(sellerId);
  }
});
