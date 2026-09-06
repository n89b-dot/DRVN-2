import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";
import { signIn, type TestUser } from "./helpers";

async function createOwner(): Promise<TestUser & { id: string }> {
  const admin = fixtureAdmin();
  const token = randomUUID().replaceAll("-", "");
  const user = {
    email: `e2e-activity-${token}@drvn.test`,
    password: `Activity-${randomUUID()}!`,
    username: `activity${token}`.slice(0, 24),
    displayName: "Activity recovery owner",
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

test("activity restores a browser draft and a lost publish response cannot duplicate it", async ({ page }) => {
  test.setTimeout(120_000);
  const admin = fixtureAdmin();
  const owner = await createOwner();
  try {
    const car = await admin
      .from("cars")
      .insert({
        owner_id: owner.id,
        slug: `activity-${randomUUID()}`,
        name: "Activity recovery car",
        is_public: true,
      })
      .select("id,slug")
      .single();
    if (car.error) throw car.error;

    await signIn(page, owner);
    const editorPath = `/garage/${car.data.id}/update/new`;
    await page.goto(editorPath);
    const title = page.getByLabel(/^title$/i);
    const body = page.getByLabel("Update body");
    const titleText = "Recovered publish operation";
    const bodyText = "This browser copy survives the interrupted publish response.";
    await title.fill(titleText);
    await body.fill(bodyText);

    // Reload before the debounce can reach the server. The browser recovery
    // record restores title, document, and the same publish operation UUID.
    await page.reload();
    await expect(page.getByLabel(/^title$/i)).toHaveValue(titleText);
    await expect(page.getByLabel("Update body")).toContainText(bodyText);
    await expect(page.getByText("Saved — only you can see it")).toBeVisible();

    let interrupted = false;
    await page.route(`**${editorPath}*`, async (route) => {
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

    await page.getByRole("button", { name: /^\[?\s*publish\s*\]?$/i }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "draft is still here" }),
    ).toBeVisible();
    await expect(page.getByLabel(/^title$/i)).toHaveValue(titleText);
    await expect(page.getByLabel("Update body")).toContainText(bodyText);
    await expect.poll(async () => {
      const rows = await admin
        .from("activity_posts")
        .select("id")
        .eq("car_id", car.data.id)
        .not("published_at", "is", null);
      return rows.data?.length;
    }).toBe(1);

    await page.getByRole("button", { name: /^\[?\s*publish\s*\]?$/i }).click();
    await expect(page).toHaveURL(new RegExp(`/cars/${car.data.slug}/activity/[0-9a-f-]+$`));
    const published = await admin
      .from("activity_posts")
      .select("id,title")
      .eq("car_id", car.data.id)
      .not("published_at", "is", null);
    expect(published.data).toEqual([expect.objectContaining({ title: titleText })]);
    const drafts = await admin
      .from("activity_posts")
      .select("id")
      .eq("car_id", car.data.id)
      .is("published_at", null)
      .is("draft_archived_at", null);
    expect(drafts.data).toEqual([]);
  } finally {
    await cleanupFixtureUser(owner.id);
  }
});
