import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { assertAccessible } from "./accessibility";
import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

// RR-15: a provider-facing admin operation whose answer was lost blocks the
// same action on the same record. The console lists it, an admin records
// what happened, and the block lifts — without calling the provider.

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replaceAll("=", "")]
    .map((character) => alphabet.indexOf(character).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

test("a stuck provider operation is listed, resolved by an admin, and stops blocking", async ({ page }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Admin fixtures require the isolated local stack");
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const admin = fixtureAdmin();
  const stamp = randomUUID();
  const password = `Admin-${randomUUID()}!`;
  const actor = await admin.auth.admin.createUser({ email: `e2e-admin-reconcile-${stamp}@drvn.test`, password, email_confirm: true });
  const buyer = await admin.auth.admin.createUser({ email: `e2e-reconcile-buyer-${stamp}@drvn.test`, email_confirm: true });
  const seller = await admin.auth.admin.createUser({ email: `e2e-reconcile-seller-${stamp}@drvn.test`, email_confirm: true });
  if (!actor.data.user || !buyer.data.user || !seller.data.user) throw actor.error ?? buyer.error ?? seller.error;
  const actorId = actor.data.user.id;
  try {
    const named = await admin.from("profiles").update({ username: `reconciler${stamp.replaceAll("-", "").slice(0, 14)}` }).eq("id", actorId);
    if (named.error) throw named.error;
    const granted = await admin.from("admin_users").insert({ user_id: actorId, role: "admin" });
    if (granted.error) throw granted.error;
    const order = await admin
      .from("orders")
      .insert({ buyer_id: buyer.data.user.id, seller_id: seller.data.user.id, status: "paid", subtotal_cents: 5000, shipping_cents: 0, platform_fee_cents: 500, total_cents: 5000, currency: "USD" })
      .select("id")
      .single();
    if (order.error) throw order.error;
    const orderId = order.data.id;

    // A refund that went out to the provider and never came back.
    const begin = () =>
      admin.rpc("begin_admin_external_operation", {
        p_actor: actorId,
        p_action: "order.force_refund",
        p_subject_type: "order",
        p_subject: orderId,
        p_order: orderId,
        p_reason: `Refund fixture ${stamp}`,
        p_metadata: {},
      });
    const first = await begin();
    if (first.error) throw first.error;
    const operationId = (first.data as { operationId: string }).operationId;
    const blocked = await begin();
    expect((blocked.data as { reused: boolean }).reused).toBe(true);

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(actor.data.user.email!);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    await page.goto("/admin/audit");
    await expect(page).toHaveURL(/\/admin-verify/);
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const secret = page.locator("code");
    await expect(secret).toBeVisible();
    await page.getByLabel("Authenticator code").fill(totp((await secret.textContent())!));
    await page.getByRole("button", { name: /verify/i }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);

    const pending = page.getByRole("region", { name: "Operations that need reconciliation" });
    // RR-22: the reconciliation list and its dialog meet WCAG A/AA.
    await assertAccessible(page, "audit log with operations needing reconciliation");
    const row = pending.locator(".auditrow").filter({ hasText: operationId.slice(0, 8) });
    await expect(row).toContainText("order.force_refund");
    await row.getByRole("button", { name: "Resolve" }).click();
    const dialog = page.getByRole("dialog", { name: "Record what happened" });
    await expect(dialog).toBeVisible();
    await assertAccessible(page, "record-outcome dialog");
    await dialog.getByLabel("Did it go through at the provider?").selectOption("not_applied");
    await dialog.getByLabel(/How you checked/).fill(`Stripe dashboard shows no refund ${stamp}`);

    // The answer to the first attempt is lost: the dialog doesn't offer the
    // command again, even after closing and reopening, until a reload.
    let interrupted = false;
    await page.route("**/admin/audit", async (route) => {
      if (!interrupted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        interrupted = true;
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "Record outcome" }).click();
    await expect(dialog.getByRole("alert")).toContainText("couldn't confirm whether this ran");
    await expect(dialog.getByRole("button", { name: "Record outcome" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await row.getByRole("button", { name: "Resolve" }).click();
    await expect(dialog.getByRole("button", { name: "Record outcome" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Reload to see what happened" }).click();
    await page.unroute("**/admin/audit");

    // Nothing was recorded (the request never reached the server), so it is
    // still pending; resolve it for real.
    await row.getByRole("button", { name: "Resolve" }).click();
    await dialog.getByLabel("Did it go through at the provider?").selectOption("not_applied");
    await dialog.getByLabel(/How you checked/).fill(`Stripe dashboard shows no refund ${stamp}`);
    await dialog.getByRole("button", { name: "Record outcome" }).click();
    await expect(page.locator("output.toast").filter({ hasText: "Recorded as not done" })).toBeVisible();

    await page.reload();
    await expect(page.locator(".auditrow").filter({ hasText: operationId.slice(0, 8) }).filter({ hasText: "no answer recorded" })).toHaveCount(0);
    const record = await admin
      .from("admin_audit_log")
      .select("actor_id, metadata")
      .eq("metadata->>operationId", operationId)
      .eq("metadata->>phase", "reconciled")
      .single();
    expect(record.data?.actor_id).toBe(actorId);
    expect(record.data?.metadata).toMatchObject({ outcome: "not_applied", reconciles: "order.force_refund" });

    // The block has lifted: the same action on the same order starts fresh.
    const again = await begin();
    expect((again.data as { reused: boolean; operationId: string }).reused).toBe(false);
    expect((again.data as { operationId: string }).operationId).not.toBe(operationId);
  } finally {
    await cleanupFixtureUser(buyer.data.user.id);
    await cleanupFixtureUser(seller.data.user.id);
    await cleanupFixtureUser(actorId);
  }
});
