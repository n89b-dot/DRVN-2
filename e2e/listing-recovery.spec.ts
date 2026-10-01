import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

test("listing create, publish and delete retries converge after committed responses are lost", async ({ page }) => {
  test.skip(
    process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation",
    "Listing recovery fixtures are restricted to the isolated local stack"
  );
  test.setTimeout(120_000);

  const admin = fixtureAdmin();
  const stamp = randomUUID();
  const email = `e2e-listing-recovery-${stamp}@drvn.test`;
  const password = `Listing-${randomUUID()}!`;
  const title = `Response-loss listing ${stamp}`;
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw user.error ?? new Error("Missing listing user");
  const invitationId = randomUUID();

  try {
    const profile = await admin.from("profiles").upsert({
      id: user.data.user.id,
      username: `listing${stamp.replaceAll("-", "").slice(0, 18)}`,
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
      consumed_by: user.data.user.id,
    });
    if (invited.error) throw invited.error;
    const membership = await admin.from("beta_memberships").insert({
      user_id: user.data.user.id,
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

    let loseCreate = true;
    await page.route("**/sell*", async (route) => {
      if (
        loseCreate &&
        route.request().method() === "POST" &&
        route.request().headers()["next-action"]
      ) {
        loseCreate = false;
        const response = await route.fetch();
        // Next 16.3 answers a fetch-action redirect 200 + x-action-redirect (16.2 sent 303).
        expect([200, 303]).toContain(response.status());
        expect(response.headers()["x-action-redirect"]).toContain("/listings/");
        return route.abort("failed");
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(async () => {
      const result = await admin.from("listings").select("id").eq("seller_id", user.data.user.id).eq("title", title);
      if (result.error) throw result.error;
      return result.data.length;
    }).toBe(1);
    await expect(page.getByLabel("Title")).toHaveValue(title);
    await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(/\/listings\/[0-9a-f-]+\/edit\?saved=draft/);

    const created = await admin
      .from("listings")
      .select("id,status")
      .eq("seller_id", user.data.user.id)
      .eq("title", title);
    if (created.error) throw created.error;
    expect(created.data).toHaveLength(1);
    expect(created.data[0].status).toBe("draft");

    await page.goto("/listings");
    let row = page.locator("tr.ledger__row").filter({ hasText: title });
    let loseStatus = true;
    await page.route("**/listings*", async (route) => {
      if (
        loseStatus &&
        route.request().method() === "POST" &&
        route.request().headers()["next-action"]
      ) {
        loseStatus = false;
        expect((await route.fetch()).status()).toBe(200);
        return route.abort("failed");
      }
      return route.continue();
    });
    await row.getByRole("button", { name: /^\[?\s*Publish\s*\]?$/ }).click();
    await expect.poll(async () => {
      const result = await admin.from("listings").select("status").eq("id", created.data[0].id).single();
      if (result.error) throw result.error;
      return result.data.status;
    }).toBe("active");
    await expect(row.getByRole("button", { name: /^\[?\s*Publish\s*\]?$/ })).toBeEnabled();
    await row.getByRole("button", { name: /^\[?\s*Publish\s*\]?$/ }).click();
    row = page.locator("tr.ledger__row").filter({ hasText: title });
    await expect(row.getByRole("button", { name: /^\[?\s*Pause\s*\]?$/ })).toBeVisible();

    // Pause and reactivation are desired-state writes. Losing each committed
    // response leaves the control retryable, and the replay converges.
    loseStatus = true;
    await row.getByRole("button", { name: /^\[?\s*Pause\s*\]?$/ }).click();
    await expect.poll(async () => (await admin.from("listings").select("status").eq("id", created.data[0].id).single()).data?.status).toBe("paused");
    await expect(row.getByRole("button", { name: /^\[?\s*Pause\s*\]?$/ })).toBeEnabled();
    await row.getByRole("button", { name: /^\[?\s*Pause\s*\]?$/ }).click();
    row = page.locator("tr.ledger__row").filter({ hasText: title });
    await expect(row.getByRole("button", { name: /^\[?\s*Relist\s*\]?$/ })).toBeVisible();

    loseStatus = true;
    await row.getByRole("button", { name: /^\[?\s*Relist\s*\]?$/ }).click();
    await expect.poll(async () => (await admin.from("listings").select("status").eq("id", created.data[0].id).single()).data?.status).toBe("active");
    await expect(row.getByRole("button", { name: /^\[?\s*Relist\s*\]?$/ })).toBeEnabled();
    await row.getByRole("button", { name: /^\[?\s*Relist\s*\]?$/ }).click();
    row = page.locator("tr.ledger__row").filter({ hasText: title });
    await expect(row.getByRole("button", { name: /^\[?\s*Pause\s*\]?$/ })).toBeVisible();

    let loseDelete = true;
    await page.route("**/listings*", async (route) => {
      if (
        loseDelete &&
        route.request().method() === "POST" &&
        route.request().headers()["next-action"]
      ) {
        loseDelete = false;
        const response = await route.fetch();
        // Next 16.3 answers a fetch-action redirect 200 + x-action-redirect (16.2 sent 303).
        expect([200, 303]).toContain(response.status());
        expect(response.headers()["x-action-redirect"]).toContain("/listings?deleted=1");
        return route.abort("failed");
      }
      return route.continue();
    });
    await row.getByRole("button", { name: /^\[?\s*Delete\s*\]?$/ }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this listing?" });
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await expect.poll(async () => {
      const result = await admin.from("listings").select("id").eq("id", created.data[0].id);
      if (result.error) throw result.error;
      return result.data.length;
    }).toBe(0);
    await expect(dialog.getByRole("button", { name: "Delete permanently" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page).toHaveURL(/\/listings\?deleted=1/);

    // A rejected first admission discards its unused request claim. The same
    // form's second click must be rate-limited again rather than being treated
    // as an already-admitted recovery.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const limited = await admin.rpc("consume_rate_limit", {
        p_key: `listing:${user.data.user.id}`,
        p_limit: 20,
        p_window: "3600 seconds",
      });
      if (limited.error) throw limited.error;
    }
    const deniedTitle = `Rate denied ${stamp}`;
    await page.goto("/sell");
    await page.getByLabel("Title").fill(deniedTitle);
    await page.getByLabel("Category", { exact: true }).selectOption("performance");
    await page.getByLabel("Asking price").fill("75.00");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByRole("alert").filter({ hasText: /Limit: 20 per 60 minutes/ })).toBeVisible();
      const denied = await admin.from("listings").select("id").eq("seller_id", user.data.user.id).eq("title", deniedTitle);
      if (denied.error) throw denied.error;
      expect(denied.data).toHaveLength(0);
    }
  } finally {
    await cleanupFixtureUser(user.data.user.id);
    const invitation = await admin.from("beta_invitations").delete().eq("id", invitationId);
    if (invitation.error) throw invitation.error;
  }
});
