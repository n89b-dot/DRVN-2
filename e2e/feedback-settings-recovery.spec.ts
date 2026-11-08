import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";
import { signIn, type TestUser } from "./helpers";

async function createUser(label: string): Promise<TestUser & { id: string }> {
  const admin = fixtureAdmin();
  const token = randomUUID().replaceAll("-", "");
  const user = {
    email: `e2e-${label}-${token}@drvn.test`,
    password: `Feedback-${randomUUID()}!`,
    // N38: a handle is lowercase a-z, 0-9 and _ only; labels carry hyphens.
    username: `e2e${label.toLowerCase().replace(/[^a-z0-9_]/g, "")}${token}`.slice(0, 24),
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

test("question draft survives a lost committed response and retry inserts only once", async ({ page }) => {
  const admin = fixtureAdmin();
  const seller = await createUser("question-seller");
  const buyer = await createUser("question-buyer");
  try {
    const car = await admin
      .from("cars")
      .insert({ owner_id: seller.id, slug: `question-${randomUUID()}`, name: "Question fixture", is_public: true })
      .select("id")
      .single();
    if (car.error) throw car.error;
    const listing = await admin
      .from("listings")
      .insert({
        seller_id: seller.id,
        source_car_id: car.data.id,
        title: "Q&A recovery bracket",
        category: "performance",
        price_cents: 12_500,
        shipping_cents: 0,
        currency: "USD",
        status: "active",
      })
      .select("id")
      .single();
    if (listing.error) throw listing.error;

    await signIn(page, buyer);
    await page.goto(`/listings/${listing.data.id}`);
    const input = page.getByLabel("Ask the seller a question");
    const text = "Does this include the mounting bracket?";
    await input.fill(text);

    let interrupted = false;
    await page.route(`**/listings/${listing.data.id}*`, async (route) => {
      const request = route.request();
      if (!interrupted && request.method() === "POST" && request.headers()["next-action"]) {
        interrupted = true;
        await route.fetch();
        await route.fulfill({ status: 503, contentType: "text/plain", body: "response interrupted" });
      } else {
        await route.continue();
      }
    });

    await page.getByRole("button", { name: /Ask/ }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "response was interrupted" }),
    ).toBeVisible();
    await expect(input).toHaveValue(text);
    await expect.poll(async () => {
      const result = await admin
        .from("listing_questions")
        .select("id")
        .eq("listing_id", listing.data.id)
        .eq("author_id", buyer.id);
      return result.data?.length;
    }).toBe(1);

    await page.getByRole("button", { name: /Ask/ }).click();
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(input).toHaveValue("");
    const persisted = await admin
      .from("listing_questions")
      .select("id,body")
      .eq("listing_id", listing.data.id)
      .eq("author_id", buyer.id);
    expect(persisted.data).toEqual([expect.objectContaining({ body: text })]);
  } finally {
    await cleanupFixtureUser(buyer.id);
    await cleanupFixtureUser(seller.id);
  }
});

test("analytics preference reports an interrupted save, retries, and persists after reload", async ({ page }) => {
  const admin = fixtureAdmin();
  const user = await createUser("analytics");
  try {
    await signIn(page, user);
    await page.goto("/settings#privacy");
    const checkbox = page.getByRole("checkbox", { name: /Allow optional product analytics/ });
    await checkbox.check();

    let interrupted = false;
    await page.route("**/settings*", async (route) => {
      const request = route.request();
      if (!interrupted && request.method() === "POST" && request.headers()["next-action"]) {
        interrupted = true;
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });

    await page.getByRole("button", { name: /Save privacy preference/ }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "response was interrupted" }),
    ).toBeVisible();
    await expect(checkbox).toBeChecked();
    expect((await admin.from("analytics_consents").select("allowed").eq("user_id", user.id).maybeSingle()).data).toBeNull();

    await page.getByRole("button", { name: /Save privacy preference/ }).click();
    await expect(page.getByRole("status")).toContainText("Privacy preference saved");
    await expect.poll(async () =>
      (await admin.from("analytics_consents").select("allowed").eq("user_id", user.id).single()).data?.allowed
    ).toBe(true);
    await page.reload();
    await expect(page.getByRole("checkbox", { name: /Allow optional product analytics/ })).toBeChecked();
  } finally {
    await cleanupFixtureUser(user.id);
  }
});

test("profile success feedback clears when the saved fields change", async ({ page }) => {
  const user = await createUser("profile-feedback");
  try {
    await signIn(page, user);
    await page.goto("/profile");
    await page.getByRole("button", { name: /Edit profile/ }).click();
    const dialog = page.getByRole("dialog", { name: "Profile details" });
    await dialog.getByRole("button", { name: /Save profile/ }).click();
    await expect(dialog.getByText("Profile saved", { exact: true })).toBeVisible();

    await dialog.getByLabel("Headline").fill("A newer unsaved headline");
    await expect(dialog.getByText("Profile saved", { exact: true })).toHaveCount(0);
  } finally {
    await cleanupFixtureUser(user.id);
  }
});

test("settings reject invalid profile and account inputs without losing corrections", async ({ page }) => {
  const user = await createUser("settings-invalid");
  try {
    await signIn(page, user);
    await page.goto("/settings#keeper");
    const displayName = page.getByRole("textbox", { name: "Display name" });
    const bio = page.getByRole("textbox", { name: "Bio" });
    await displayName.fill("N".repeat(81));
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "display name under 80" })).toBeVisible();
    await expect(displayName).toHaveValue("N".repeat(81));

    await displayName.fill("Valid corrected name");
    await bio.fill("B".repeat(1001));
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "bio under 1000" })).toBeVisible();
    await expect(bio).toHaveValue("B".repeat(1001));

    await page.goto("/settings#account");
    const current = page.getByLabel("Current password");
    const next = page.getByLabel("New password", { exact: true });
    const confirm = page.getByLabel("Confirm new password");
    await current.fill(user.password);
    await next.fill("Changed-password-1!");
    await confirm.fill("Different-password-2!");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "passwords don't match" })).toBeVisible();
    await expect(current).toHaveValue(user.password);
    await expect(next).toHaveValue("Changed-password-1!");
    await expect(confirm).toHaveValue("Different-password-2!");

    await next.fill("short");
    await confirm.fill("short");
    await next.evaluate((input) => { input.closest("form")!.noValidate = true; });
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "at least 8 characters" })).toBeVisible();
  } finally {
    await cleanupFixtureUser(user.id);
  }
});
