import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";
import { signIn } from "./helpers";

test("a lost committed photo-upload response leaves a recoverable orphan and attaches one retry", async ({ page, request }) => {
  test.skip(
    process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation",
    "Upload recovery fixtures are restricted to the isolated local stack"
  );
  const admin = fixtureAdmin();
  const token = randomUUID().replaceAll("-", "");
  const user = {
    email: `e2e-gallery-upload-${token}@drvn.test`,
    password: `Gallery-${randomUUID()}!`,
    username: `galleryupload${token}`.slice(0, 24),
    displayName: "Gallery upload recovery",
  };
  const created = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw created.error ?? new Error("Missing gallery user");

  try {
    const named = await admin
      .from("profiles")
      .update({ username: user.username, display_name: user.displayName })
      .eq("id", created.data.user.id);
    if (named.error) throw named.error;
    const car = await admin
      .from("cars")
      .insert({
        owner_id: created.data.user.id,
        slug: `gallery-upload-${randomUUID()}`,
        name: "Upload response recovery",
        is_public: true,
      })
      .select("id")
      .single();
    if (car.error) throw car.error;

    await signIn(page, user);
    const editPath = `/garage/${car.data.id}/edit`;
    const serverRender = await page.context().request.get(editPath);
    expect(serverRender.status()).toBe(200);
    const serverHtml = await serverRender.text();
    const serverFileInput = serverHtml.match(/<input(?=[^>]*\btype=["']file["'])[^>]*>/i)?.[0];
    expect(serverFileInput, "the server render includes the gallery file input").toBeDefined();
    expect(serverFileInput, "the server-rendered input stays inert until hydration").toMatch(
      /\sdisabled(?:=""|="disabled"|(?=\s|>))/i
    );

    await page.goto(editPath);
    const gallery = page.locator("section").filter({ hasText: "Drag (or ↑↓) to reorder" });
    await expect(gallery.locator('input[type="file"]')).toBeEnabled();
    await expect(gallery.getByRole("button", { name: /Add the first photos/ })).not.toHaveAttribute("aria-disabled", "true");
    let lostResponse = false;
    await page.route("**/api/media/public-photo", async route => {
      if (!lostResponse) {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        lostResponse = true;
        return route.abort("failed");
      }
      return route.continue();
    });

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    await gallery.locator('input[type="file"]').setInputFiles({
      name: "committed-upload.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect.poll(() => lostResponse).toBe(true);
    await expect(gallery.getByRole("alert")).toContainText(/failed|finish uploading/i);
    await expect(gallery.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();

    const stagedAfterLoss = await admin
      .from("staged_uploads")
      .select("id,path,url,consumed_at")
      .eq("owner_id", created.data.user.id);
    if (stagedAfterLoss.error) throw stagedAfterLoss.error;
    expect(stagedAfterLoss.data).toHaveLength(1);
    expect(stagedAfterLoss.data[0].consumed_at).toBeNull();
    expect((await admin.from("car_images").select("id").eq("car_id", car.data.id)).data).toEqual([]);

    await gallery.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(gallery.locator(".thumb")).toHaveCount(1);
    const [stagedAfterRetry, attached] = await Promise.all([
      admin.from("staged_uploads").select("id,path,url,consumed_at").eq("owner_id", created.data.user.id),
      admin.from("car_images").select("id,url").eq("car_id", car.data.id),
    ]);
    if (stagedAfterRetry.error) throw stagedAfterRetry.error;
    if (attached.error) throw attached.error;
    expect(stagedAfterRetry.data).toHaveLength(2);
    const orphan = stagedAfterRetry.data.find(row => row.consumed_at === null);
    const consumed = stagedAfterRetry.data.find(row => row.consumed_at !== null);
    expect(orphan, "the lost-response upload remains tracked for GC").toBeDefined();
    expect(consumed, "the retried upload is finalized after attachment").toBeDefined();
    expect(attached.data).toEqual([
      expect.objectContaining({ url: consumed!.url }),
    ]);
    await page.reload();
    await expect(gallery.locator(".thumb")).toHaveCount(1);

    // Expire only this test's lost-response upload and exercise the real,
    // bearer-gated local worker. It must remove the orphan bytes and ledger
    // while preserving the attached retry object.
    const expired = await admin
      .from("staged_uploads")
      .update({ created_at: new Date(Date.now() - 49 * 60 * 60_000).toISOString() })
      .eq("id", orphan!.id);
    if (expired.error) throw expired.error;
    const gc = await request.post("/api/jobs/media-gc", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    expect(gc.status()).toBe(200);
    const gcResult = await gc.json() as { removed: number; skipped: number };
    expect(gcResult.removed).toBeGreaterThanOrEqual(1);
    expect(gcResult.skipped).toBe(0);

    expect((await admin.from("staged_uploads").select("id").eq("id", orphan!.id)).data).toEqual([]);
    expect((await admin.storage.from("car-images").download(orphan!.path)).error).not.toBeNull();
    expect((await admin.storage.from("car-images").download(consumed!.path)).error).toBeNull();
    expect((await admin.from("car_images").select("id,url").eq("car_id", car.data.id)).data).toEqual([
      expect.objectContaining({ url: consumed!.url }),
    ]);
  } finally {
    await cleanupFixtureUser(created.data.user.id);
  }
});
