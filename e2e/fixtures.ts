import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertIsolatedTestTarget } from "../tests/support/test-target";

/** This helper is intentionally usable only with the explicit isolated test target. */
export function fixtureAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = process.env.E2E_TEST_PROJECT_REF;
  if (!url || !key || !ref) throw new Error("Fixtures require explicit isolated test configuration");
  assertIsolatedTestTarget({ url, projectRef: ref });
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * N136 (20261107200500): a new console member's authenticator only counts
 * once the operator confirms it with them. The spec plays the operator: it
 * reads the reference /admin-verify shows after enrolment, checks it is the
 * member's verified factor, confirms it, and returns to the page that asked.
 */
export async function confirmAdminAuthenticator(page: Page, admin: SupabaseClient, userId: string, next: string) {
  const reference = page.getByRole("status").locator("code");
  await expect(reference).toBeVisible();
  const factorId = (await reference.textContent())?.trim() ?? "";
  const factors = await admin.auth.admin.mfa.listFactors({ userId });
  if (factors.error) throw factors.error;
  if (!factors.data.factors.some((factor) => factor.id === factorId && factor.status === "verified")) {
    throw new Error("The reference shown is not the member's verified authenticator");
  }
  const confirmed = await admin.rpc("confirm_admin_mfa", { p_user: userId, p_factor: factorId, p_confirmed_by: "e2e operator: synthetic fixture identity" });
  if (confirmed.error) throw confirmed.error;
  await page.goto(next);
}

/** A public car and its live part. `watchers` adds that many other accounts
 *  that have saved the part, so the public "N watching" count is real. */
export async function createDiscoveryFixture({ watchers = 0 }: { watchers?: number } = {}) {
  const admin = fixtureAdmin();
  const token = randomUUID();
  const user = await admin.auth.admin.createUser({ email: `e2e-discovery-${token}@drvn.test`, email_confirm: true });
  if (user.error || !user.data.user) throw user.error ?? new Error("Missing fixture user");
  const userId = user.data.user.id;
  const watcherIds: string[] = [];
  const cleanup = async () => {
    for (const id of watcherIds) await cleanupFixtureUser(id);
    await cleanupFixtureUser(userId);
  };
  try {
    const car = await admin.from("cars").insert({ owner_id: userId, slug: `fixture-${token}`, name: "Fixture public build", is_public: true }).select("id,slug").single();
    if (car.error) throw car.error;
    const listing = await admin.from("listings").insert({ seller_id: userId, title: "Fixture brake set", category: "performance", price_cents: 10000, shipping_cents: 0, currency: "USD", status: "active", source_car_id: car.data.id }).select("id").single();
    if (listing.error) throw listing.error;
    for (let n = 0; n < watchers; n += 1) {
      const watcher = await admin.auth.admin.createUser({ email: `e2e-watcher-${n}-${token}@drvn.test`, email_confirm: true });
      if (watcher.error || !watcher.data.user) throw watcher.error ?? new Error("Missing watcher");
      watcherIds.push(watcher.data.user.id);
      const saved = await admin.from("saves").insert({ user_id: watcher.data.user.id, target_type: "listing", target_id: listing.data.id });
      if (saved.error) throw saved.error;
    }
    return { listingPath: `/listings/${listing.data.id}`, carPath: `/cars/${car.data.slug}`, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

/** Enumerate before deletion so cascade-generated search work remains attributable. */
export async function cleanupFixtureUser(userId: string) {
  const admin = fixtureAdmin();
  const ids = [userId];
  for (const [table, owner] of [["listings", "seller_id"], ["cars", "owner_id"], ["activity_posts", "author_id"]]) {
    for (let offset = 0; ; offset += 500) {
      const result = await admin.from(table).select("id").eq(owner, userId).order("id").range(offset, offset + 499);
      if (result.error) throw result.error;
      ids.push(...result.data.map(row => row.id));
      if (result.data.length < 500) break;
    }
  }
  const receipts = await admin.from("remediation_jobs").delete().eq("kind", "receipt").eq("payload->>buyer_id", userId);
  if (receipts.error) throw receipts.error;
  const [audit, adjustments] = await Promise.all([
    admin.from("admin_audit_log").select("id").eq("actor_id", userId).limit(1),
    admin.from("seller_adjustments").select("id").eq("seller_id", userId).limit(1),
  ]);
  if (audit.error || adjustments.error) throw audit.error ?? adjustments.error;
  if (audit.data.length || adjustments.data.length) {
    // Immutable financial/audit fixtures retain their identity FK. They must
    // lose access and public visibility without deleting protected history.
    const membership = await admin.from("admin_users").delete().eq("user_id", userId); if (membership.error) throw membership.error;
    const banned = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" }); if (banned.error) throw banned.error;
    const scrubbed = await admin.from("profiles").update({ username: null, display_name: "Retained test ledger actor", suspended_at: new Date().toISOString(), suspended_reason: "Completed isolated test fixture" }).eq("id", userId); if (scrubbed.error) throw scrubbed.error;
  } else {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) throw removed.error;
  }
  for (let offset = 0; offset < ids.length; offset += 100) {
    const jobs = await admin.from("remediation_jobs").delete().eq("kind", "search").in("payload->>id", ids.slice(offset, offset + 100));
    if (jobs.error) throw jobs.error;
  }
}
