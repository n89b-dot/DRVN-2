import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";
import { signIn, type TestUser } from "./helpers";

async function createUser(label: string): Promise<TestUser & { id: string }> {
  const admin = fixtureAdmin();
  const token = randomUUID().replaceAll("-", "");
  const user = {
    email: `e2e-${label}-${token}@drvn.test`,
    password: `Social-${randomUUID()}!`,
    username: `e2e${label}${token}`.slice(0, 24),
    displayName: `E2E ${label}`,
  };
  const created = await admin.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true });
  if (created.error) throw created.error;
  const named = await admin.from("profiles").update({ username: user.username, display_name: user.displayName }).eq("id", created.data.user.id);
  if (named.error) throw named.error;
  return { ...user, id: created.data.user.id };
}

test("social actions recover from a failed response and persist through removal and reload", async ({ page }) => {
  const admin = fixtureAdmin();
  const viewer = await createUser("social-viewer");
  const owner = await createUser("social-owner");
  try {
    const car = await admin.from("cars").insert({ owner_id: owner.id, slug: `social-${randomUUID()}`, name: "Recovery build", is_public: true }).select("id,slug").single();
    if (car.error) throw car.error;
    await signIn(page, viewer);
    await page.goto(`/cars/${car.data.slug}`);

    let interrupted = false;
    await page.route(`**/cars/${car.data.slug}`, async (route) => {
      const request = route.request();
      if (!interrupted && request.method() === "POST" && request.headers()["next-action"]) {
        interrupted = true;
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });

    await page.getByRole("button", { name: /Save\b/ }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Couldn't update that" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Save\b/ })).toHaveAttribute("aria-pressed", "false");
    expect((await admin.from("saves").select("target_id").eq("user_id", viewer.id).eq("target_type", "car").eq("target_id", car.data.id)).data).toEqual([]);

    await page.getByRole("button", { name: /Save\b/ }).click();
    await expect(page.getByRole("button", { name: /Saved/ })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await admin.from("saves").select("target_id").eq("user_id", viewer.id).eq("target_id", car.data.id)).data?.length).toBe(1);
    await page.reload();
    await expect(page.getByRole("button", { name: /Saved/ })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: /Saved/ }).click();
    await expect(page.getByRole("button", { name: /Save\b/ })).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await admin.from("saves").select("target_id").eq("user_id", viewer.id).eq("target_id", car.data.id)).data?.length).toBe(0);
    await page.reload();
    await expect(page.getByRole("button", { name: /Save\b/ })).toHaveAttribute("aria-pressed", "false");
  } finally {
    await cleanupFixtureUser(viewer.id);
    await cleanupFixtureUser(owner.id);
  }
});

test("notification click-through persists read state and renders write-failure feedback", async ({ page }) => {
  const admin = fixtureAdmin();
  const viewer = await createUser("notice-viewer");
  const owner = await createUser("notice-owner");
  try {
    const car = await admin.from("cars").insert({ owner_id: owner.id, slug: `notice-${randomUUID()}`, name: "Notification destination", is_public: true }).select("slug").single();
    if (car.error) throw car.error;
    const notices = await admin.from("notifications").insert([
      { user_id: viewer.id, kind: "follow", section: "engagement", title: "Read recovery", href: `/cars/${car.data.slug}` },
      { user_id: viewer.id, kind: "save", section: "engagement", title: "Write failure", href: `/cars/${car.data.slug}` },
    ]).select("id,title");
    if (notices.error) throw notices.error;
    const readId = notices.data.find((row) => row.title === "Read recovery")!.id;
    const failureId = notices.data.find((row) => row.title === "Write failure")!.id;
    expect((await admin.from("notifications").select("read_at").eq("id", failureId).single()).data?.read_at).toBeNull();

    await signIn(page, viewer);
    await page.goto("/notifications");
    await page.getByRole("link", { name: /Read recovery/ }).click();
    await expect(page).toHaveURL(new RegExp(`/cars/${car.data.slug}$`));
    await expect.poll(async () => (await admin.from("notifications").select("read_at").eq("id", readId).single()).data?.read_at).not.toBeNull();
    await page.goto("/notifications");
    await expect(page.getByRole("link", { name: /Read recovery/ }).getByLabel("unread")).toHaveCount(0);

    await page.route(`**/notifications/open/${failureId}*`, async (route) => {
      await route.fulfill({ status: 307, headers: { location: "/notifications?notice=read_failed" } });
    });
    expect((await admin.from("notifications").select("read_at").eq("id", failureId).single()).data?.read_at).toBeNull();
    await page.getByRole("link", { name: /Write failure/ }).click();
    await expect(page).toHaveURL(/\/notifications\?notice=read_failed$/);
    await expect(
      page.getByRole("alert").filter({ hasText: "still unread" }),
    ).toBeVisible();
    expect((await admin.from("notifications").select("read_at").eq("id", failureId).single()).data?.read_at).toBeNull();
  } finally {
    await cleanupFixtureUser(viewer.id);
    await cleanupFixtureUser(owner.id);
  }
});
