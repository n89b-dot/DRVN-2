import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

test("mod-sheet retry converges after a lost response and keeps adjacent draft edits", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation",
    "Modification recovery fixtures are restricted to the isolated local stack"
  );
  test.setTimeout(120_000);

  const admin = fixtureAdmin();
  const stamp = randomUUID();
  const email = `e2e-mod-sheet-${stamp}@drvn.test`;
  const password = `Mods-${randomUUID()}!`;
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw user.error ?? new Error("Missing mod-sheet user");

  try {
    const profile = await admin
      .from("profiles")
      .update({ username: `mods${stamp.replaceAll("-", "").slice(0, 19)}` })
      .eq("id", user.data.user.id);
    if (profile.error) throw profile.error;
    const car = await admin
      .from("cars")
      .insert({
        owner_id: user.data.user.id,
        slug: `mod-recovery-${stamp}`,
        name: "Mod recovery fixture",
      })
      .select("id")
      .single();
    if (car.error) throw car.error;

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);
    const editPath = `/garage/${car.data.id}/edit`;
    await page.goto(editPath);

    const editor = page.locator("section").filter({ hasText: "The build — seed the lines" });
    await editor.getByRole("button", { name: "+ Add a line manually" }).click();
    await editor.getByRole("button", { name: "+ Add a line manually" }).click();
    const rows = editor.locator(".modrow");
    await expect(rows).toHaveCount(2);
    await rows.nth(0).getByLabel("Brand").fill("APR");
    await rows.nth(0).getByLabel("Product").fill("Intake");
    await rows.nth(1).getByLabel("Brand").fill("KW");
    await rows.nth(1).getByLabel("Product").fill("Coilovers");

    let loseCommittedResponse = true;
    await page.route(`**${editPath}*`, async (route) => {
      if (
        loseCommittedResponse &&
        route.request().method() === "POST" &&
        route.request().headers()["next-action"]
      ) {
        loseCommittedResponse = false;
        expect((await route.fetch()).status()).toBe(200);
        return route.abort("failed");
      }
      return route.continue();
    });

    await editor.getByRole("button", { name: "Save the build" }).click();
    await expect(editor.getByRole("alert")).toContainText("Your changes are still here");
    await expect(rows.nth(0).getByLabel("Product")).toHaveValue("Intake");
    await expect(rows.nth(1).getByLabel("Product")).toHaveValue("Coilovers");

    const committed = await admin
      .from("mod_items")
      .select("id,brand,product,position")
      .eq("car_id", car.data.id)
      .order("position");
    if (committed.error) throw committed.error;
    expect(committed.data).toHaveLength(2);
    const stableIds = committed.data.map((item) => item.id);

    // Both values remain editable after the transport failure. Retrying sends
    // the complete current sheet using the same client UUIDs.
    await rows.nth(0).getByLabel("Product").fill("Carbon intake");
    await rows.nth(1).getByLabel("Product").fill("V3 coilovers");
    await editor.getByRole("button", { name: "Save the build" }).click();
    await expect(editor.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await expect(editor.getByRole("button", { name: "Save the build" })).toBeEnabled();

    await editor.getByRole("button", { name: "Save the build" }).click();
    await expect(editor.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await expect(editor.getByRole("button", { name: "Save the build" })).toBeEnabled();
    const replayed = await admin
      .from("mod_items")
      .select("id,brand,product,position")
      .eq("car_id", car.data.id)
      .order("position");
    if (replayed.error) throw replayed.error;
    expect(replayed.data).toEqual([
      { id: stableIds[0], brand: "APR", product: "Carbon intake", position: 0 },
      { id: stableIds[1], brand: "KW", product: "V3 coilovers", position: 1 },
    ]);

    const details = page.locator("section").filter({ hasText: "Details — shown on the build page" });
    await details.getByLabel("Color").fill("Sepang Blue");
    let loseCarEdit = true;
    await page.route(`**${editPath}*`, async route => {
      if (loseCarEdit && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        loseCarEdit = false;
        expect((await route.fetch()).status()).toBe(200);
        return route.abort("failed");
      }
      return route.continue();
    });
    await details.getByRole("button", { name: "Save changes" }).click();
    await expect(details.getByRole("alert")).toContainText("changes are still here");
    await expect(details.getByLabel("Color")).toHaveValue("Sepang Blue");
    await expect
      .poll(async () => {
        const result = await admin.from("cars").select("color").eq("id", car.data.id).single();
        if (result.error) throw result.error;
        return result.data.color;
      })
      .toBe("Sepang Blue");
    await details.getByRole("button", { name: "Save changes" }).click();
    await expect(details.getByRole("status")).toContainText("Changes saved.");
    await details.getByLabel("Color").fill("Sepang Blue Metallic");
    await expect(details.getByRole("status")).toHaveCount(0);

    const danger = page.locator("section").filter({ hasText: "Delete this car — irreversible" });
    await danger.getByRole("button", { name: "Delete this car" }).click();
    const dialog = page.getByRole("dialog", { name: 'Delete "Mod recovery fixture"?' });
    await dialog.getByLabel(/Type Mod recovery fixture to confirm/).fill("Mod recovery fixture");
    let loseCarDelete = true;
    await page.route(`**${editPath}*`, async route => {
      if (loseCarDelete && route.request().method() === "POST" && route.request().headers()["next-action"]) {
        loseCarDelete = false;
        expect((await route.fetch()).status()).toBe(200);
        return route.abort("failed");
      }
      return route.continue();
    });
    await dialog.getByRole("button", { name: "Delete this car" }).click();
    await expect(dialog.getByRole("alert")).toContainText(/Couldn.t confirm the deletion/);
    await expect(dialog.getByRole("button", { name: "Delete this car" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Delete this car" }).click();
    await expect(page).toHaveURL(/\/garage$/);
    await expect(page.getByText("Mod recovery fixture", { exact: true })).toHaveCount(0);
    await expect
      .poll(async () => {
        const result = await admin.from("cars").select("id").eq("id", car.data.id);
        if (result.error) throw result.error;
        return result.data.length;
      })
      .toBe(0);
  } finally {
    await cleanupFixtureUser(user.data.user.id);
  }
});
