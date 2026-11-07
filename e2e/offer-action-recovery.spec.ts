import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

test.describe("offer decision interruption recovery", () => {
  test.setTimeout(60_000);
  const password = `Offer-action-${randomUUID()}!`;
  const sellerEmail = `e2e-offer-action-seller-${randomUUID()}@drvn.test`;
  const buyerEmail = `e2e-offer-action-buyer-${randomUUID()}@drvn.test`;
  const users: string[] = [];

  test.beforeAll(async () => {
    test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Offer action fixtures are restricted to the isolated local stack");
    const admin = fixtureAdmin();
    for (const [email, role] of [[sellerEmail, "seller"], [buyerEmail, "buyer"]] as const) {
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw created.error ?? new Error("Missing offer user");
      users.push(created.data.user.id);
      const named = await admin.from("profiles").update({ username: `offeract${randomUUID().replaceAll("-", "").slice(0, 16)}` }).eq("id", created.data.user.id);
      if (named.error) throw named.error;
      const invitationId = randomUUID();
      const invitation = await admin.from("beta_invitations").insert({ id: invitationId, email_normalized: email, roles: [role], token_hash: createHash("sha256").update(randomUUID()).digest("hex"), expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), consumed_at: new Date().toISOString(), consumed_by: created.data.user.id });
      if (invitation.error) throw invitation.error;
      const membership = await admin.from("beta_memberships").insert({ user_id: created.data.user.id, invitation_id: invitationId, email_normalized: email, roles: [role] });
      if (membership.error) throw membership.error;
    }
  });

  test.afterAll(async () => {
    for (const id of users.reverse()) await cleanupFixtureUser(id);
  });

  async function login(page: Page, email: string) {
    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
  }

  async function offer(status = "open") {
    const admin = fixtureAdmin();
    const listing = await admin.from("listings").insert({ seller_id: users[0], title: `Offer action ${randomUUID()}`, category: "performance", price_cents: 10000, shipping_cents: 0, currency: "USD", status: "active" }).select("id").single();
    if (listing.error) throw listing.error;
    const created = await admin.from("offers").insert({ listing_id: listing.data.id, buyer_id: users[1], amount_cents: 8000, status, counter_amount_cents: status === "countered" ? 9000 : null }).select("id, listing_id").single();
    if (created.error) throw created.error;
    return created.data;
  }

  async function loseCommittedResponse(page: Page, offerId: string) {
    let interrupted = false;
    await page.route(`**/offers/${offerId}`, async route => {
      if (!interrupted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        interrupted = true;
        const response = await route.fetch();
        expect([200, 303]).toContain(response.status());
        await route.abort("failed");
      } else await route.continue();
    });
  }

  test("counter retries the exact committed amount", async ({ page }) => {
    const row = await offer();
    await login(page, sellerEmail);
    await page.goto(`/offers/${row.id}`);
    await page.getByRole("button", { name: /counter/i }).click();
    await page.getByLabel("Your counter").fill("90.00");
    await loseCommittedResponse(page, row.id);
    await page.getByRole("button", { name: /send counter/i }).click();
    await expect(page.getByRole("main").getByRole("alert").filter({ hasText: "Retry to check the saved result" })).toBeVisible();
    await expect(page.getByLabel("Your counter")).toHaveValue("90.00");
    await page.getByRole("button", { name: /send counter/i }).click();
    await expect(page.getByRole("main").getByRole("alert").filter({ hasText: "Counter sent" })).toBeVisible();
    const saved = await fixtureAdmin().from("offers").select("status,counter_amount_cents").eq("id", row.id).single();
    expect(saved.data).toEqual({ status: "countered", counter_amount_cents: 9000 });
  });

  test("decline replay confirms the committed decision", async ({ page }) => {
    const row = await offer();
    await login(page, sellerEmail);
    await page.goto(`/offers/${row.id}`);
    await loseCommittedResponse(page, row.id);
    await page.getByRole("button", { name: /pass/i }).click();
    await expect(page.getByRole("main").getByRole("alert").filter({ hasText: "Retry to check the saved result" })).toBeVisible();
    await page.getByRole("button", { name: /pass/i }).click();
    // The settled page and the move's note, together: the note outlives the
    // buttons it came from rather than flashing before the page settles.
    await expect(page.getByRole("main").getByText("declined", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert").filter({ hasText: "Offer declined" })).toBeVisible();
  });

  test("withdraw retry remains safe after the first request committed", async ({ page }) => {
    const row = await offer();
    await login(page, buyerEmail);
    await page.goto(`/offers/${row.id}`);
    await loseCommittedResponse(page, row.id);
    await page.getByRole("button", { name: /withdraw offer/i }).click();
    await expect(page.getByRole("main").getByRole("alert").filter({ hasText: "Retry to check the saved result" })).toBeVisible();
    await page.getByRole("button", { name: /withdraw offer/i }).click();
    await expect(page.getByRole("main").getByText("withdrawn", { exact: true })).toBeVisible();
    await expect.poll(async () => (await fixtureAdmin().from("offers").select("status").eq("id", row.id).single()).data?.status).toBe("withdrawn");
  });

  test("seller accept replay confirms its one reserved order", async ({ page }) => {
    const row = await offer();
    await login(page, sellerEmail);
    await page.goto(`/offers/${row.id}`);
    await loseCommittedResponse(page, row.id);
    await page.getByRole("button", { name: /accept \$80/i }).click();
    await expect(page.getByRole("main").getByRole("alert").filter({ hasText: "Retry to check the saved result" })).toBeVisible();
    await page.getByRole("button", { name: /accept \$80/i }).click();
    await expect(page.getByRole("main").getByRole("link", { name: /^Order [0-9A-F]{8} →$/ })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert").filter({ hasText: "Offer accepted" })).toBeVisible();
    const orders = await fixtureAdmin().from("orders").select("id").eq("origin_offer_id", row.id);
    expect(orders.data).toHaveLength(1);
  });

  test("buyer counter acceptance retry reaches the original checkout", async ({ page }) => {
    const row = await offer("countered");
    await login(page, buyerEmail);
    await page.goto(`/offers/${row.id}`);
    await loseCommittedResponse(page, row.id);
    // The button names the counter's amount (9000 cents in the fixture).
    const acceptCounter = page.getByRole("button", { name: /^\[?\s*Accept \$90(\.00)?\s*\]?$/ });
    await acceptCounter.click();
    await expect(page.getByRole("main").getByRole("alert").filter({ hasText: "Retry to check the saved result" })).toBeVisible();
    await acceptCounter.click();
    await expect(page).toHaveURL(/\/orders\/[\w-]+\/checkout$/);
    const orders = await fixtureAdmin().from("orders").select("id").eq("origin_offer_id", row.id);
    expect(orders.data).toHaveLength(1);
  });
});
