import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";
import { addComposerPhoto, signIn, type TestUser } from "./helpers";

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
    // Without a photo the status line leads with what publishing still needs
    // (composer.tsx shows the publish reason ahead of the save state).
    await expect(page.locator("#composer-status")).toHaveText("Add a photo to publish");

    // W-2: a new publish needs a photo. Once it's on, the status line can
    // report the autosave — the restored draft reached the server.
    await addComposerPhoto(page);
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
    if (published.error) throw published.error;
    if (!published.data) throw new Error("Published activity row was not returned");
    expect(published.data).toEqual([expect.objectContaining({ title: titleText })]);
    const drafts = await admin
      .from("activity_posts")
      .select("id")
      .eq("car_id", car.data.id)
      .is("published_at", null)
      .is("draft_archived_at", null);
    expect(drafts.data).toEqual([]);

    const postId = published.data[0].id;
    const editPath = `/garage/${car.data.id}/update/${postId}/edit`;
    await page.goto(editPath);
    const revisedTitle = "Recovered edited operation";
    await page.getByLabel(/^title$/i).fill(revisedTitle);
    interrupted = false;
    await page.route(`**${editPath}*`, async route => {
      if (!interrupted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        interrupted = true;
        expect((await route.fetch()).status()).toBe(200);
        return route.abort("failed");
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "response was interrupted" })).toBeVisible();
    await expect(page.getByLabel(/^title$/i)).toHaveValue(revisedTitle);
    await expect.poll(async () => (await admin.from("activity_posts").select("title").eq("id", postId).single()).data?.title).toBe(revisedTitle);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Update saved.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/^title$/i)).toHaveValue(revisedTitle);

    await page.getByRole("button", { name: "Delete this entry" }).click();
    interrupted = false;
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Couldn.t confirm the deletion/ })).toBeVisible();
    await expect.poll(async () => (await admin.from("activity_posts").select("id").eq("id", postId)).data?.length).toBe(0);
    await expect(page.getByRole("button", { name: "Delete permanently" })).toBeEnabled();
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page).toHaveURL(new RegExp(`/garage/${car.data.id}/edit$`));
    await page.reload();
    await expect(page.getByText(revisedTitle, { exact: true })).toHaveCount(0);
  } finally {
    await cleanupFixtureUser(owner.id);
  }
});
