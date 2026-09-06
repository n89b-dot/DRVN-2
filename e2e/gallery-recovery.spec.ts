import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

test("gallery order retries converge and a failed description save keeps the draft", async ({ page }) => {
  test.setTimeout(120_000);
  const admin = fixtureAdmin();
  const email = `e2e-gallery-${randomUUID()}@drvn.test`, password = `Gallery-${randomUUID()}!`;
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error) throw user.error;
  try {
    const named = await admin.from("profiles").update({ username: `gallery${randomUUID().replaceAll("-", "").slice(0, 16)}` }).eq("id", user.data.user.id);
    if (named.error) throw named.error;
    const car = await admin.from("cars").insert({ owner_id: user.data.user.id, slug: `gallery-${randomUUID()}`, name: "Gallery recovery", is_public: true }).select("id").single();
    if (car.error) throw car.error;
    const photos = await admin.from("car_images").insert([0, 1].map(position => ({ car_id: car.data.id, position, alt: `Original photo ${position}`, url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/car-images/${user.data.user.id}/${car.data.id}/${position}.webp` }))).select("id,position");
    if (photos.error) throw photos.error;
    const ids = photos.data.sort((a, b) => a.position - b.position).map(photo => photo.id);
    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/home/);
    await page.goto(`/garage/${car.data.id}/edit`);
    const gallery = page.locator("section").filter({ hasText: "Photos — drag" });
    let loseCommit = true, failBeforeCommit = false;
    await page.route(`**/garage/${car.data.id}/edit*`, async route => {
      if (route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
      if (loseCommit) { loseCommit = false; expect((await route.fetch()).status()).toBe(200); return route.abort("failed"); }
      if (failBeforeCommit) { failBeforeCommit = false; return route.abort("failed"); }
      return route.continue();
    });
    await gallery.getByRole("button", { name: "Move photo 1 later" }).click();
    await expect(gallery.getByRole("alert")).toContainText("Couldn't confirm");
    await gallery.getByRole("button", { name: "Move photo 1 later" }).click();
    await expect.poll(async () => (await admin.from("car_images").select("id").eq("car_id", car.data.id).order("position")).data?.map(row => row.id)).toEqual([...ids].reverse());
    await page.reload();
    await expect(gallery.locator(".thumb").first().getByRole("img")).toHaveAttribute("alt", "Original photo 1");
    await gallery.getByRole("button", { name: "Edit description for photo 1" }).click();
    const description = gallery.getByRole("textbox", { name: "Photo description" });
    await description.fill("Retained description draft");
    failBeforeCommit = true;
    await gallery.getByRole("button", { name: /Save/ }).click();
    await expect(gallery.getByRole("alert")).toContainText("Couldn't save the description");
    await expect(description).toHaveValue("Retained description draft");
    await gallery.getByRole("button", { name: /Save/ }).click();
    await expect(description).toHaveCount(0);
    await page.reload();
    await expect(gallery.locator(".thumb").first().getByRole("img")).toHaveAttribute("alt", "Retained description draft");

    // The object upload and the gallery attachment are separate boundaries.
    // Lose only the Server Action response after its database commit: Retry
    // must retain the uploaded File/URL and adopt the row by URL, without
    // uploading the bytes again or adding a duplicate gallery row.
    loseCommit = true;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    let loseUploadBytes = true;
    await page.route("**/api/media/public-photo", async route => {
      if (loseUploadBytes) {
        loseUploadBytes = false;
        return route.abort("failed");
      }
      return route.continue();
    });
    await gallery
      .locator('input[type="file"]')
      .setInputFiles({ name: "pending-attachment.png", mimeType: "image/png", buffer: png });
    await expect(gallery.getByRole("alert")).toContainText(/failed|finish uploading/i);
    expect((await admin.from("car_images").select("id").eq("car_id", car.data.id)).data).toHaveLength(2);
    await gallery.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(gallery.getByRole("alert")).toContainText("photo uploaded, but the gallery save wasn't confirmed");
    await expect
      .poll(async () => {
        const result = await admin.from("car_images").select("id").eq("car_id", car.data.id);
        if (result.error) throw result.error;
        return result.data.length;
      })
      .toBe(3);
    await gallery.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(gallery.locator(".thumb")).toHaveCount(3);
    const attached = await admin.from("car_images").select("id").eq("car_id", car.data.id);
    if (attached.error) throw attached.error;
    expect(attached.data).toHaveLength(3);
  } finally { await cleanupFixtureUser(user.data.user.id); }
});
