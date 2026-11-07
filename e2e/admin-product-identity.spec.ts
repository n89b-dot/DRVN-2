import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { cleanupFixtureUser, confirmAdminAuthenticator, fixtureAdmin } from "./fixtures";

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replaceAll("=", "")]
    .map((character) => alphabet.indexOf(character).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

// B1: the product identity review list. An admin sees two brands' products
// sharing a number, keeps them separate with a note, and the decision lands
// under Decided, in the database and in the audit log.
test("admin decides an ambiguous product identity from the review list", async ({ page }) => {
  test.skip(
    process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation",
    "Product identity fixtures are restricted to the isolated local stack"
  );
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);

  const admin = fixtureAdmin();
  const stamp = randomUUID();
  const tag = stamp.replaceAll("-", "").slice(0, 10);
  const number = `e2e${tag}1`;
  const password = `Admin-${randomUUID()}!`;
  const actor = await admin.auth.admin.createUser({
    email: `e2e-product-admin-${stamp}@drvn.test`,
    password,
    email_confirm: true,
  });
  if (actor.error || !actor.data.user) throw actor.error ?? new Error("Missing product admin fixture");
  const actorId = actor.data.user.id;
  const productIds: string[] = [];
  let reviewId: string | undefined;

  try {
    const named = await admin.from("profiles").update({ username: `products${tag}` }).eq("id", actorId);
    if (named.error) throw named.error;
    const granted = await admin.from("admin_users").insert({ user_id: actorId, role: "admin" });
    if (granted.error) throw granted.error;

    const products = await admin
      .from("products")
      .insert([
        { brand_key: `boschx${tag}`, brand: `Bosch ${tag}`, name: "EV14 injector", created_from: "listing" },
        { brand_key: `delphix${tag}`, brand: `Delphi ${tag}`, name: "Injector", created_from: "listing" },
      ])
      .select("id, brand_key");
    if (products.error) throw products.error;
    productIds.push(...products.data.map((p) => p.id));
    const members = await admin.from("product_part_numbers").insert(
      products.data.map((p) => ({
        brand_key: p.brand_key,
        number_compact: number,
        number: number.toUpperCase(),
        product_id: p.id,
        basis: "brand_and_number",
      }))
    );
    if (members.error) throw members.error;
    const review = await admin
      .from("product_identity_reviews")
      .insert({
        kind: "number_across_brands",
        dedup_key: `nab:${number}:e2e`,
        number_compact: number,
        brand_keys: products.data.map((p) => p.brand_key),
        product_ids: productIds,
      })
      .select("id")
      .single();
    if (review.error) throw review.error;
    reviewId = review.data.id;

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(actor.data.user.email!);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    await page.goto("/admin/products");
    await expect(page).toHaveURL(/\/admin-verify/);
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const secret = page.locator("code");
    await expect(secret).toBeVisible();
    await page.getByLabel("Authenticator code").fill(totp((await secret.textContent())!));
    await page.getByRole("button", { name: /verify/i }).click();
    await confirmAdminAuthenticator(page, admin, actorId, "/admin/products");
    await expect(page).toHaveURL(/\/admin\/products$/);

    await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
    await expect(page.getByLabel("Product coverage")).toContainText("Listings with a product");
    const row = page.locator(".order").filter({ hasText: number });
    await expect(row).toContainText("One number, several brands");
    await expect(row).toContainText(`Bosch ${tag} · EV14 injector — ${number.toUpperCase()}`);
    await expect(row).toContainText(`Delphi ${tag}`);

    await row.getByRole("button", { name: "Decide" }).click();
    const dialog = page.getByRole("dialog", { name: "Decide product identity" });
    await dialog.getByLabel("Decision").selectOption("keep_separate");
    await dialog.getByLabel(/Why/).fill(`Different makers ${stamp}`);
    await dialog.getByRole("button", { name: "Record decision" }).click();
    await expect(page.locator("output.toast").filter({ hasText: "Kept separate." })).toBeVisible();

    await expect
      .poll(async () => {
        const result = await admin.from("product_identity_reviews").select("status, resolved_by").eq("id", reviewId!).single();
        if (result.error) throw result.error;
        return result.data;
      })
      .toEqual({ status: "kept_separate", resolved_by: actorId });
    const audit = await admin
      .from("admin_audit_log")
      .select("action, subject_type, reason")
      .eq("subject_id", reviewId)
      .single();
    if (audit.error) throw audit.error;
    expect(audit.data).toEqual({ action: "product.keep_separate", subject_type: "product_review", reason: `Different makers ${stamp}` });

    await page.goto("/admin/products?view=closed");
    const decided = page.locator(".order").filter({ hasText: number });
    await expect(decided).toContainText("Kept separate");
    await expect(decided).toContainText(`Different makers ${stamp}`);
    await expect(decided.getByRole("button", { name: "Decide" })).toHaveCount(0);
  } finally {
    if (reviewId) await admin.from("product_identity_reviews").delete().eq("id", reviewId);
    if (productIds.length) await admin.from("products").delete().in("id", productIds);
    await cleanupFixtureUser(actorId);
  }
});
