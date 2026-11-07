import { createHmac, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { Client } from "pg";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replaceAll("=", "")]
    .map((character) => alphabet.indexOf(character).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

/**
 * R69-dmca end to end: a rights holder with no account sends a notice from
 * /copyright naming a listing and its photo; an admin takes it down from
 * Admin → Copyright after the authenticator step-up. The listing leaves the
 * marketplace, its photo is gone from the gallery, the notice is closed and
 * audited, the seller is told, and the optimised-image route refuses the
 * photo (451) instead of serving the copy Next.js cached.
 */
test("a rights holder's notice is taken down from the admin console", async ({ page, browser, baseURL }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Copyright fixtures are restricted to the isolated local stack");
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);

  const admin = fixtureAdmin();
  const stamp = randomUUID();
  const tag = stamp.replaceAll("-", "").slice(0, 10);
  const storage = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  const db = new Client({ host: "127.0.0.1", port: 54322, user: "supabase_admin", password: "postgres", database: "postgres" });
  await db.connect();

  const seller = await admin.auth.admin.createUser({ email: `e2e-copyright-seller-${stamp}@drvn.test`, password: `Seller-${stamp}!`, email_confirm: true });
  if (seller.error || !seller.data.user) throw seller.error ?? new Error("Missing seller fixture");
  const sellerId = seller.data.user.id;
  const password = `Admin-${stamp}!`;
  const actor = await admin.auth.admin.createUser({ email: `e2e-copyright-admin-${stamp}@drvn.test`, password, email_confirm: true });
  if (actor.error || !actor.data.user) throw actor.error ?? new Error("Missing admin fixture");
  const actorId = actor.data.user.id;
  let noticeId: string | undefined;

  try {
    await admin.from("profiles").update({ username: `cseller${tag}` }).eq("id", sellerId);
    await admin.from("profiles").update({ username: `cadmin${tag}` }).eq("id", actorId);
    const granted = await admin.from("admin_users").insert({ user_id: actorId, role: "admin" });
    if (granted.error) throw granted.error;
    const listing = await admin
      .from("listings")
      .insert({ seller_id: sellerId, title: `Imported turbo ${tag}`, category: "engine", price_cents: 30000, shipping_cents: 1500, status: "active", currency: "USD" })
      .select("id")
      .single();
    if (listing.error) throw listing.error;
    const listingId = listing.data.id;
    const photo = `${storage}/storage/v1/object/public/listing-images/${sellerId}/rehosted-${tag}.webp`;
    const image = await admin.from("listing_images").insert({ listing_id: listingId, url: photo, position: 0 });
    if (image.error) throw image.error;
    const optimised = `/_next/image?url=${encodeURIComponent(photo)}&w=640&q=75`;
    expect((await page.request.get(optimised)).status(), "served (or missing) before the takedown, never refused").not.toBe(451);

    // The rights holder: no account.
    const visitor = await browser.newContext();
    const form = await visitor.newPage();
    await form.goto("/copyright");
    await expect(form.getByRole("heading", { name: "Copyright notices." })).toBeVisible();
    await expect(form.getByText("Agent details not confirmed yet")).toBeVisible();
    await form.getByLabel("Your full name").fill("Pat Photographer");
    await form.getByLabel("Email").fill(`pat-${tag}@example.test`);
    await form.getByLabel("Postal address").fill("1 High Street, Leeds");
    await form.getByLabel("The work that's being copied").fill(`My photograph of a K03 turbo (${tag}).`);
    await form.getByLabel("Where it appears on DRVN").fill(`${baseURL}/listings/${listingId}\n${photo}`);
    await form.getByLabel(/good-faith belief/).check();
    await form.getByLabel(/under penalty of perjury/).check();
    await form.getByLabel("Signature").fill("Pat Photographer");
    await form.getByRole("button", { name: "Send notice" }).click();
    await expect(form.getByText(/Notice received \(reference/)).toBeVisible();
    await visitor.close();

    const stored = await db.query<{ id: string; content_urls: string[] }>(
      "select id, content_urls from public.copyright_notices where claimant_email = $1",
      [`pat-${tag}@example.test`]
    );
    expect(stored.rows).toHaveLength(1);
    noticeId = stored.rows[0].id;

    // The admin, after the authenticator step-up.
    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(actor.data.user.email!);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    await page.goto("/admin/copyright");
    await expect(page).toHaveURL(/\/admin-verify/);
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const secret = page.locator("code");
    await expect(secret).toBeVisible();
    await page.getByLabel("Authenticator code").fill(totp((await secret.textContent())!));
    await page.getByRole("button", { name: /verify/i }).click();
    await expect(page).toHaveURL(/\/admin\/copyright$/);

    const row = page.locator(".jobrow").filter({ hasText: `(${tag})` });
    await expect(row).toContainText("Pat Photographer");
    await row.getByRole("button", { name: "Take down" }).click();
    const dialog = page.getByRole("dialog", { name: "Take this content down" });
    await dialog.getByLabel("Note to the member and the audit log").fill(`Photographer's notice ${tag}`);
    await dialog.getByRole("button", { name: "Take down" }).click();
    await expect(page.locator("output.toast").filter({ hasText: "taken down" })).toBeVisible();

    await expect
      .poll(async () => (await db.query("select status from public.copyright_notices where id = $1", [noticeId])).rows[0]?.status)
      .toBe("actioned");
    const state = await db.query(
      `select l.status,
              (select count(*)::int from public.listing_images where listing_id = l.id) as photos,
              exists (select 1 from public.copyright_blocked_media where notice_id = $2) as blocked,
              exists (select 1 from public.admin_audit_log where action = 'copyright.takedown' and subject_id = $2 and actor_id = $3) as audited,
              exists (select 1 from public.notifications where user_id = l.seller_id and kind = 'copyright_takedown') as told
         from public.listings l where l.id = $1`,
      [listingId, noticeId, actorId]
    );
    expect(state.rows[0]).toEqual({ status: "removed", photos: 0, blocked: true, audited: true, told: true });
    // The proxy reads the blocked list at most every 15 seconds.
    await expect
      .poll(async () => (await page.request.get(optimised)).status(), { message: "the cached optimised copy is refused", timeout: 30_000, intervals: [2_000] })
      .toBe(451);
  } finally {
    if (noticeId) {
      await db.query("delete from public.copyright_blocked_media where notice_id = $1", [noticeId]);
      await db.query("delete from public.copyright_notices where id = $1", [noticeId]);
    }
    await db.query("delete from public.media_cleanup_queue where owner_id = $1", [sellerId]);
    await db.end();
    await cleanupFixtureUser(sellerId);
    await cleanupFixtureUser(actorId);
  }
});
