import { createHash, createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

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
  return ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

test("admin creates, copies and revokes an invitation while expired links fail clearly", async ({ page }) => {
  test.skip(
    process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation",
    "Invitation mutation fixtures are restricted to the isolated local stack"
  );
  test.setTimeout(120_000);

  const admin = fixtureAdmin();
  const originalConfig = await admin
    .from("beta_access_config")
    .select("enforced,updated_at,updated_by")
    .eq("singleton", true)
    .single();
  if (originalConfig.error) throw originalConfig.error;

  const stamp = randomUUID();
  const adminEmail = `e2e-invitation-admin-${stamp}@drvn.test`;
  const adminPassword = `Invite-${randomUUID()}!`;
  const invitedEmail = `e2e-invited-${stamp}@drvn.test`;
  const expiredEmail = `e2e-expired-${stamp}@drvn.test`;
  const expiredToken = `${randomUUID()}${randomUUID()}`;
  let adminUserId: string | undefined;

  try {
    const opened = await admin
      .from("beta_access_config")
      .update({ enforced: false, updated_by: null, updated_at: new Date().toISOString() })
      .eq("singleton", true);
    if (opened.error) throw opened.error;

    const createdAdmin = await admin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (createdAdmin.error || !createdAdmin.data.user) {
      throw createdAdmin.error ?? new Error("Missing invitation test admin");
    }
    adminUserId = createdAdmin.data.user.id;
    const profile = await admin
      .from("profiles")
      .update({ username: `invite${stamp.replaceAll("-", "").slice(0, 18)}` })
      .eq("id", adminUserId);
    if (profile.error) throw profile.error;
    const grant = await admin.from("admin_users").insert({ user_id: adminUserId });
    if (grant.error) throw grant.error;

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(adminEmail);
    await page.getByLabel(/^password$/i).fill(adminPassword);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    await page.goto("/admin/invitations");
    await expect(page).toHaveURL(/\/admin-verify/);
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const secret = page.locator("code");
    await expect(secret).toBeVisible();
    await page.getByLabel("Authenticator code").fill(totp((await secret.textContent())!));
    await page.getByRole("button", { name: /verify/i }).click();
    // MFA returns to the page that asked for it (admin-verify keeps `next`).
    await expect(page).toHaveURL(/\/admin\/invitations$/);
    // The console only offers the invitation form while the gate is enforced
    // (a75180c) — with it off, anyone can join and an invitation is moot.
    const enforced = await admin
      .from("beta_access_config")
      .update({ enforced: true, updated_by: adminUserId, updated_at: new Date().toISOString() })
      .eq("singleton", true);
    if (enforced.error) throw enforced.error;
    await page.goto("/admin/invitations");
    await expect(page.getByRole("heading", { name: "Beta invitations" })).toBeVisible();

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(process.env.NEXT_PUBLIC_SITE_URL!).origin,
    });
    await page.getByLabel("Invited email").fill(invitedEmail);
    await page.getByLabel("Expires in").selectOption("7");
    await page.getByRole("button", { name: "Create invitation" }).click();
    const linkStatus = page.getByRole("status").filter({ hasText: "One-time invitation link" });
    await expect(linkStatus).toBeVisible();
    const inviteLink = (await linkStatus.locator(".break-all").textContent())!.trim();
    const inviteUrl = new URL(inviteLink);
    expect(inviteUrl.origin).toBe(new URL(process.env.NEXT_PUBLIC_SITE_URL!).origin);
    expect(inviteUrl.pathname).toBe("/signup");
    expect(inviteUrl.searchParams.get("invite")?.length).toBeGreaterThanOrEqual(32);

    const copyButton = page.getByRole("button", { name: "Copy invitation link" });
    await copyButton.click();
    await expect(page.getByRole("button", { name: /Copied/ })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(inviteLink);

    const invitation = await admin
      .from("beta_invitations")
      .select("id,roles,token_hash")
      .eq("email_normalized", invitedEmail)
      .single();
    if (invitation.error) throw invitation.error;
    expect(invitation.data.roles).toEqual(["buyer", "seller"]);
    expect(invitation.data.token_hash).toBe(
      createHash("sha256").update(inviteUrl.searchParams.get("invite")!).digest("hex")
    );

    const activeRow = page.locator(".jobrow").filter({ hasText: invitedEmail });
    await activeRow.getByLabel("Reason for revocation").fill("Acceptance test revocation");
    await activeRow.getByRole("button", { name: /^\[?\s*Revoke\s*\]?$/ }).click();
    await expect(activeRow.getByText("revoked", { exact: true })).toBeVisible();
    await expect(activeRow.getByText("Reason: Acceptance test revocation")).toBeVisible();
    await expect(activeRow.getByRole("button", { name: /^\[?\s*Revoke\s*\]?$/ })).toHaveCount(0);
    await expect.poll(async () => {
      const result = await admin
        .from("beta_invitations")
        .select("revoked_at,revoked_by,revoke_reason")
        .eq("id", invitation.data.id)
        .single();
      if (result.error) throw result.error;
      return result.data;
    }).toMatchObject({ revoked_by: adminUserId, revoke_reason: "Acceptance test revocation" });

    await page.reload();
    await expect(activeRow.getByText("revoked", { exact: true })).toBeVisible();
    await expect(activeRow.getByText("Reason: Acceptance test revocation")).toBeVisible();

    const expired = await admin.from("beta_invitations").insert({
      email_normalized: expiredEmail,
      roles: ["buyer"],
      token_hash: createHash("sha256").update(expiredToken).digest("hex"),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      created_by: adminUserId,
    });
    if (expired.error) throw expired.error;
    await page.reload();
    const expiredRow = page.locator(".jobrow").filter({ hasText: expiredEmail });
    await expect(expiredRow.getByText("expired", { exact: true })).toBeVisible();

    await page.context().clearCookies();

    for (const attempt of [
      { url: inviteLink, email: invitedEmail },
      { url: `/signup?invite=${encodeURIComponent(expiredToken)}`, email: expiredEmail },
    ]) {
      await page.goto(attempt.url);
      await page.getByLabel(/^email$/i).fill(attempt.email);
      await page.getByLabel(/^password$/i).fill("invitation-password-123");
      await page.getByLabel(/18 or over/i).check();
      await page.getByRole("button", { name: "Accept invitation" }).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "This invitation is invalid or no longer available." })
      ).toBeVisible();
    }

    const authUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authUsers.error) throw authUsers.error;
    expect(authUsers.data.users.some((user) => [invitedEmail, expiredEmail].includes(user.email ?? ""))).toBe(false);
  } finally {
    const restored = await admin
      .from("beta_access_config")
      .update(originalConfig.data)
      .eq("singleton", true);
    if (restored.error) throw restored.error;
    const invitations = await admin
      .from("beta_invitations")
      .delete()
      .in("email_normalized", [invitedEmail, expiredEmail]);
    if (invitations.error) throw invitations.error;

    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (users.error) throw users.error;
    for (const user of users.data.users.filter((candidate) =>
      [adminEmail, invitedEmail, expiredEmail].includes(candidate.email ?? "")
    )) {
      await cleanupFixtureUser(user.id);
    }
  }
});
