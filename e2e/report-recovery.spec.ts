import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { cleanupFixtureUser, createDiscoveryFixture, fixtureAdmin } from "./fixtures";

test("report keeps details after a lost response and retry creates one moderation entry", async ({ page }) => {
  test.setTimeout(120_000);
  const admin = fixtureAdmin();
  const fixture = await createDiscoveryFixture();
  const email = `e2e-report-${randomUUID()}@drvn.test`;
  const password = `Report-${randomUUID()}!`;
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error) throw user.error;
  try {
    const named = await admin.from("profiles").update({ username: `report${randomUUID().replaceAll("-", "").slice(0, 17)}` }).eq("id", user.data.user.id);
    if (named.error) throw named.error;
    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    await page.goto(fixture.listingPath);
    await page.getByRole("button", { name: "Report this listing" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("What's wrong").selectOption("other");
    const details = `Report details ${randomUUID()}`;
    await dialog.getByRole("textbox").fill(details);
    let interrupted = false;
    await page.route(`**${fixture.listingPath}`, async (route) => {
      if (!interrupted && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        interrupted = true;
        expect((await route.fetch()).status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Your details are still here");
    await expect(dialog.getByRole("textbox")).toHaveValue(details);
    await expect(dialog.getByLabel("What's wrong")).toHaveValue("other");
    await dialog.getByRole("button", { name: "Send report" }).click();
    await expect(dialog.getByRole("status")).toContainText("Reported");
    const result = await admin.from("reports").select("id, reason, detail, status").eq("reporter_id", user.data.user.id).eq("subject_id", fixture.listingPath.split("/").at(-1)!);
    if (result.error) throw result.error;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ reason: "other", detail: details, status: "open" });
  } finally {
    await admin.from("reports").delete().eq("reporter_id", user.data.user.id);
    await cleanupFixtureUser(user.data.user.id);
    await fixture.cleanup();
  }
});
