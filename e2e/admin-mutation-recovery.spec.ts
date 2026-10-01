import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

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

test("admin user, report and case commands recover, persist and enforce permissions", async ({ page }) => {
  test.skip(process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation", "Admin mutation fixtures require the isolated local stack");
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const admin = fixtureAdmin();
  const stamp = randomUUID();
  const password = `Admin-${randomUUID()}!`;
  const actor = await admin.auth.admin.createUser({ email: `e2e-admin-command-${stamp}@drvn.test`, password, email_confirm: true });
  const target = await admin.auth.admin.createUser({ email: `e2e-admin-target-${stamp}@drvn.test`, email_confirm: true });
  const reporter = await admin.auth.admin.createUser({ email: `e2e-admin-reporter-${stamp}@drvn.test`, email_confirm: true });
  if (actor.error || target.error || reporter.error || !actor.data.user || !target.data.user || !reporter.data.user) {
    throw actor.error ?? target.error ?? reporter.error ?? new Error("Missing admin command fixture user");
  }
  const actorId = actor.data.user.id;
  const targetId = target.data.user.id;
  const reporterId = reporter.data.user.id;
  const targetName = `target${stamp.replaceAll("-", "").slice(0, 18)}`;
  const listingTitle = `Admin moderation ${stamp}`;
  let reportId: string | undefined;
  let recoveryId: string | undefined;
  try {
    const named = await admin.from("profiles").update({ username: targetName, display_name: "Admin target fixture" }).eq("id", targetId);
    if (named.error) throw named.error;
    const namedActor = await admin.from("profiles").update({ username: `operator${stamp.replaceAll("-", "").slice(0, 16)}` }).eq("id", actorId);
    if (namedActor.error) throw namedActor.error;
    const listing = await admin.from("listings").insert({ seller_id: targetId, title: listingTitle, category: "performance", price_cents: 12000, currency: "USD", status: "active" });
    if (listing.error) throw listing.error;
    const granted = await admin.from("admin_users").insert({ user_id: actorId, role: "admin" });
    if (granted.error) throw granted.error;
    const recovery = await admin.from("payment_recoveries").insert({ kind: "negative_balance", recovery_key: `admin-browser:${stamp}`, detail: `Financial fixture ${stamp}`, amount_cents: 321 }).select("id").single();
    if (recovery.error) throw recovery.error;
    recoveryId = recovery.data.id;
    const report = await admin.from("reports").insert({ reporter_id: reporterId, subject_type: "user", subject_id: targetId, reason: "other", detail: `Admin-visible ${stamp}` }).select("id").single();
    if (report.error) throw report.error;
    reportId = report.data.id;
    const taggedCase = await admin.from("ops_cases").update({ summary: `fixture ${stamp}` }).eq("report_id", reportId);
    if (taggedCase.error) throw taggedCase.error;

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(actor.data.user.email!);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    await page.goto(`/admin/users/${targetId}`);
    await expect(page).toHaveURL(/\/admin-verify/);
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const secret = page.locator("code");
    await expect(secret).toBeVisible();
    await page.getByLabel("Authenticator code").fill(totp((await secret.textContent())!));
    await page.getByRole("button", { name: /verify/i }).click();
    // MFA returns to the page that asked for it (admin-verify keeps `next`).
    await expect(page).toHaveURL(new RegExp(`/admin/users/${targetId}$`));

    await page.goto(`/admin/listings?q=${encodeURIComponent(listingTitle)}`);
    const listingRow = page.getByRole("row").filter({ hasText: listingTitle });
    await listingRow.getByRole("button", { name: "Take down" }).click();
    let takedown = page.getByRole("dialog", { name: `Remove “${listingTitle}”` });
    const removalReason = `Policy review ${stamp}`;
    await takedown.getByLabel(/Reason/).fill(removalReason);
    await takedown.locator('input[name="listing_id"]').evaluate((input) => ((input as HTMLInputElement).value = ""));
    await takedown.getByRole("button", { name: "Remove listing" }).click();
    await expect(takedown.getByRole("alert")).toContainText("Missing listing");
    await expect(takedown.getByLabel(/Reason/)).toHaveValue(removalReason);
    await page.reload();
    await page.getByRole("row").filter({ hasText: listingTitle }).getByRole("button", { name: "Take down" }).click();
    takedown = page.getByRole("dialog", { name: `Remove “${listingTitle}”` });
    await takedown.getByLabel(/Reason/).fill(removalReason);
    await takedown.getByRole("button", { name: "Remove listing" }).click();
    await expect(page.locator("output.toast").filter({ hasText: "Listing removed" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: listingTitle })).toContainText("removed");
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: listingTitle })).toContainText("removed");
    await page.getByRole("row").filter({ hasText: listingTitle }).getByRole("button", { name: "Restore" }).click();
    const restore = page.getByRole("dialog", { name: `Restore “${listingTitle}”` });
    await restore.getByLabel(/Reason/).fill(`Restored after review ${stamp}`);
    await restore.getByRole("button", { name: "Restore listing" }).click();
    await expect(page.locator("output.toast").filter({ hasText: "Listing restored" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: listingTitle })).toContainText("paused");
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: listingTitle })).toContainText("paused");

    await page.goto(`/admin/users/${targetId}`);
    await page.getByRole("button", { name: /Suspend/ }).click();
    const suspend = page.getByRole("dialog", { name: /Suspend Admin target fixture/ });
    const suspensionReason = `Browser recovery ${stamp}`;
    await suspend.getByLabel(/Reason/).fill(suspensionReason);
    let interrupted = false;
    await page.route(`**/admin/users/${targetId}`, async (route) => {
      if (!interrupted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        interrupted = true;
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await suspend.getByRole("button", { name: "Suspend user" }).click();
    await expect(suspend.getByRole("alert")).toContainText("reload the console before trying again");
    await expect(suspend.getByLabel(/Reason/)).toHaveValue(suspensionReason);
    await page.unroute(`**/admin/users/${targetId}`);
    await page.reload();
    await expect(page.getByText("suspended", { exact: true }).first()).toBeVisible();
    await expect(page.locator('section[aria-label="Account"]').getByText(suspensionReason, { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Add note" }).click();
    const note = page.getByRole("dialog", { name: "Internal note" });
    const noteText = `Follow-up evidence ${stamp}`;
    await note.getByRole("textbox", { name: "Note", exact: true }).fill(noteText);
    await note.getByRole("button", { name: "Record note" }).click();
    await expect(page.locator("output.toast").filter({ hasText: "Note recorded" })).toBeVisible();
    await page.reload();
    await expect(page.locator('section[aria-label="Admin history"]').getByText(noteText, { exact: false })).toBeVisible();

    await page.goto("/admin/reports");
    await expect(page.getByText(`Admin-visible ${stamp}`)).toBeVisible();
    await page.goto("/admin/cases?kind=report");
    const caseRow = page.locator(".jobrow").filter({ hasText: `fixture ${stamp}` });
    await caseRow.getByRole("button", { name: "Claim" }).click();
    await expect(caseRow.getByRole("status")).toContainText("Claimed");
    await caseRow.getByRole("button", { name: "Label" }).click();
    await caseRow.getByLabel("Priority").selectOption("high");
    await caseRow.getByLabel("Labels").fill("fraud, urgent");
    let caseInterrupted = false;
    await page.route("**/admin/cases**", async (route) => {
      if (!caseInterrupted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        caseInterrupted = true;
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await caseRow.getByRole("button", { name: "Save" }).click();
    await expect(caseRow.getByRole("alert")).toContainText("Your labels are still here");
    await expect(caseRow.getByLabel("Labels")).toHaveValue("fraud, urgent");
    await page.unroute("**/admin/cases**");
    await page.reload();
    await expect(page.locator(".jobrow").filter({ hasText: `fixture ${stamp}` })).toContainText("fraud, urgent");

    await page.goto("/admin/reports");
    const reportRow = page.locator(".jobrow").filter({ hasText: `Admin-visible ${stamp}` });
    await reportRow.getByRole("button", { name: "Resolve" }).click();
    const resolution = page.getByRole("dialog", { name: "Resolve report" });
    await resolution.getByLabel("Outcome").selectOption("dismissed");
    await resolution.getByLabel("Resolution note").fill(`Reviewed ${stamp}`);
    await resolution.locator("button[type=submit]").click();
    await expect(page.locator("output.toast").filter({ hasText: "Report dismissed" })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: /Open/ }).getByText(`Admin-visible ${stamp}`)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("tabpanel", { name: /Open/ }).getByText(`Admin-visible ${stamp}`)).toHaveCount(0);
    await page.getByRole("tab", { name: /Resolved/ }).click();
    await expect(page.getByText(`Admin-visible ${stamp}`)).toBeVisible();

    await page.goto("/admin/payments");
    const recoveryRow = page.locator(".jobrow").filter({ hasText: `Financial fixture ${stamp}` });
    await recoveryRow.getByRole("button", { name: "Close case" }).click();
    const closeRecovery = page.getByRole("dialog", { name: "Close recovery case" });
    const recoveryNote = `Local write-off exercise ${stamp}`;
    await closeRecovery.getByLabel("Outcome").selectOption("written_off");
    await closeRecovery.getByLabel("What happened").fill(recoveryNote);
    await closeRecovery.locator("button[type=submit]").click();
    await expect(page.locator("output.toast").filter({ hasText: "Recovery case closed" })).toBeVisible();
    await expect(page.locator(".jobrow").filter({ hasText: `Financial fixture ${stamp}` })).toHaveCount(0);
    await page.reload();
    await page.getByText(/closed case/).click();
    await expect(page.getByText(recoveryNote, { exact: false })).toBeVisible();

    await admin.from("admin_users").update({ role: "viewer" }).eq("user_id", actorId);
    await page.goto(`/admin/users/${targetId}`);
    await page.getByRole("button", { name: /Unsuspend/ }).click();
    const unsuspend = page.getByRole("dialog", { name: /Lift suspension/ });
    await unsuspend.getByLabel(/Reason/).fill(`Viewer attempted ${stamp}`);
    await unsuspend.locator("button[type=submit]").click();
    await expect(unsuspend.getByRole("alert")).toContainText("Read-only access");
    await expect(unsuspend.getByLabel(/Reason/)).toHaveValue(`Viewer attempted ${stamp}`);
    const profile = await admin.from("profiles").select("suspended_at").eq("id", targetId).single();
    expect(profile.data?.suspended_at).not.toBeNull();
  } finally {
    if (recoveryId) await admin.from("payment_recoveries").delete().eq("id", recoveryId);
    if (reportId) await admin.from("reports").delete().eq("id", reportId);
    await cleanupFixtureUser(targetId);
    await cleanupFixtureUser(reporterId);
    await cleanupFixtureUser(actorId);
  }
});
