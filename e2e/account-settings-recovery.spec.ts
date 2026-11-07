import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";
import { signIn, type TestUser } from "./helpers";

async function createUser(label: string): Promise<TestUser & { id: string }> {
  const admin = fixtureAdmin();
  const token = randomUUID().replaceAll("-", "");
  const user = {
    email: `e2e-${label}-${token}@drvn.test`,
    password: `Account-${randomUUID()}!`,
    username: `e2e${label}${token}`.slice(0, 24),
    displayName: `E2E ${label}`,
  };
  const created = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const named = await admin
    .from("profiles")
    .update({ username: user.username, display_name: user.displayName })
    .eq("id", created.data.user.id);
  if (named.error) throw named.error;
  return { ...user, id: created.data.user.id };
}

test("email change refuses without the password, then survives a lost committed response and a retry adopts the pending change", async ({ page }) => {
  const admin = fixtureAdmin();
  const user = await createUser("account-email");
  const nextEmail = `e2e-changed-${randomUUID().replaceAll("-", "")}@drvn.test`;
  try {
    await signIn(page, user);
    await page.goto("/settings");
    const email = page.getByLabel("Sign-in email");
    await email.fill(nextEmail);
    // N41: moving the sign-in email asks for the password, typed now. A
    // wrong one moves nothing.
    const password = page.getByLabel("Your password");
    await password.fill("not-the-password");
    await page.getByRole("button", { name: /Update email/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: "That password isn't right." })).toBeVisible();
    const untouched = await admin.auth.admin.getUserById(user.id);
    if (untouched.error) throw untouched.error;
    expect(untouched.data.user.new_email || null).toBeNull();
    expect(untouched.data.user.email).toBe(user.email);
    await password.fill(user.password);

    let interrupted = false;
    await page.route("**/settings*", async (route) => {
      const request = route.request();
      if (!interrupted && request.method() === "POST" && request.headers()["next-action"]) {
        interrupted = true;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });

    await page.getByRole("button", { name: /Update email/ }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "email may already be pending" }),
    ).toBeVisible();
    await expect(email).toHaveValue(nextEmail);
    await expect.poll(async () => {
      const result = await admin.auth.admin.getUserById(user.id);
      if (result.error) throw result.error;
      return result.data.user.new_email === nextEmail || result.data.user.email === nextEmail;
    }).toBe(true);

    await page.getByRole("button", { name: /Update email/ }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /already.*sign-in email|already pending/ }),
    ).toBeVisible();
    await expect(email).toHaveValue(nextEmail);
  } finally {
    await cleanupFixtureUser(user.id);
  }
});

test("password entries survive a lost committed response and retry confirms the active password", async ({ page }) => {
  const user = await createUser("account-password");
  const nextPassword = `Changed-${randomUUID()}!`;
  try {
    await signIn(page, user);
    await page.goto("/settings");
    const current = page.getByLabel("Current password");
    const next = page.getByLabel("New password", { exact: true });
    const confirm = page.getByLabel("Confirm new password");
    await current.fill(user.password);
    await next.fill(nextPassword);
    await confirm.fill(nextPassword);

    let interrupted = false;
    await page.route("**/settings*", async (route) => {
      const request = route.request();
      if (!interrupted && request.method() === "POST" && request.headers()["next-action"]) {
        interrupted = true;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });

    await page.getByRole("button", { name: /Change password/ }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "entries are still here" }),
    ).toBeVisible();
    await expect(current).toHaveValue(user.password);
    await expect(next).toHaveValue(nextPassword);
    await expect(confirm).toHaveValue(nextPassword);

    await page.getByRole("button", { name: /Change password/ }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Password updated" }),
    ).toBeVisible();
    await expect(current).toHaveValue("");
    await expect(next).toHaveValue("");
    await expect(confirm).toHaveValue("");

    await page.context().clearCookies();
    await signIn(page, { ...user, password: nextPassword });
  } finally {
    await cleanupFixtureUser(user.id);
  }
});
