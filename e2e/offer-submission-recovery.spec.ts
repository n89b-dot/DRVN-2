import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

test("offer and opening message survive one committed response loss without duplication", async ({ page }) => {
  test.skip(
    process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation",
    "Offer recovery fixtures are restricted to the isolated local stack",
  );
  test.setTimeout(120_000);
  const admin = fixtureAdmin();
  const stamp = randomUUID();
  const password = `Offer-${randomUUID()}!`;
  const buyerEmail = `e2e-offer-buyer-${stamp}@drvn.test`;
  const sellerEmail = `e2e-offer-seller-${stamp}@drvn.test`;
  const users: string[] = [];
  try {
    for (const [email, role] of [[sellerEmail, "seller"], [buyerEmail, "buyer"]] as const) {
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw created.error ?? new Error("Missing offer user");
      users.push(created.data.user.id);
      const profile = await admin.from("profiles").update({
        username: `offer${randomUUID().replaceAll("-", "").slice(0, 18)}`,
      }).eq("id", created.data.user.id);
      if (profile.error) throw profile.error;
      const invitationId = randomUUID();
      const invitation = await admin.from("beta_invitations").insert({
        id: invitationId,
        email_normalized: email,
        roles: [role],
        token_hash: createHash("sha256").update(randomUUID()).digest("hex"),
        expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        consumed_at: new Date().toISOString(),
        consumed_by: created.data.user.id,
      });
      if (invitation.error) throw invitation.error;
      const membership = await admin.from("beta_memberships").insert({
        user_id: created.data.user.id,
        invitation_id: invitationId,
        email_normalized: email,
        roles: [role],
      });
      if (membership.error) throw membership.error;
    }
    const listing = await admin.from("listings").insert({
      seller_id: users[0],
      title: `Offer recovery fixture ${stamp}`,
      category: "performance",
      price_cents: 10000,
      shipping_cents: 0,
      currency: "USD",
      status: "active",
    }).select("id").single();
    if (listing.error) throw listing.error;

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(buyerEmail);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    await page.goto(`/listings/${listing.data.id}`);
    await page.getByRole("button", { name: "Make an offer" }).click();
    const dialog = page.getByRole("dialog", { name: "Make an offer" });
    const amount = dialog.getByLabel("Your offer");
    const message = dialog.getByLabel("Message — optional");
    const body = `Please include the original hardware ${stamp}`;
    await amount.fill("90.00");
    await message.fill(body);

    let interrupted = false;
    await page.route(`**/listings/${listing.data.id}`, async (route) => {
      if (!interrupted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        interrupted = true;
        expect((await route.fetch()).status()).toBe(200);
        return route.abort("failed");
      }
      return route.continue();
    });
    await dialog.getByRole("button", { name: "Send offer" }).click();
    await expect(dialog.getByRole("alert")).toContainText("draft is still here");
    await expect(amount).toHaveValue("90.00");
    await expect(message).toHaveValue(body);
    await expect.poll(async () => {
      const rows = await admin.from("offers").select("id").eq("listing_id", listing.data.id).eq("buyer_id", users[1]);
      if (rows.error) throw rows.error;
      return rows.data.length;
    }).toBe(1);

    await dialog.getByRole("button", { name: "Send offer" }).click();
    await expect(dialog.getByText(/Offer sent/)).toBeVisible();
    await expect(amount).toHaveValue("");
    await expect(message).toHaveValue("");
    const offers = await admin.from("offers").select("id").eq("listing_id", listing.data.id).eq("buyer_id", users[1]);
    if (offers.error) throw offers.error;
    expect(offers.data).toHaveLength(1);
    const messages = await admin.from("messages").select("id,body").eq("offer_id", offers.data[0].id);
    if (messages.error) throw messages.error;
    expect(messages.data).toEqual([{ id: offers.data[0].id, body }]);
  } finally {
    for (const id of users.reverse()) await cleanupFixtureUser(id);
  }
});
