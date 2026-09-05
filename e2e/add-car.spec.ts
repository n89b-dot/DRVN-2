import { randomUUID } from "node:crypto";
import { fixtureAdmin } from "./fixtures";
import { expect, test } from "@playwright/test";

import { cleanupE2eUsers, makeUser, signUp } from "./helpers";

/**
 * Canonical Add Car (brief §E): picker primary, VIN secondary, manual always
 * available. The picker creates its own catalog fixture, so all paths must work on
 * an empty disposable project.
 */

test.describe("Add Car", () => {
  const makeName = `Fixture ${randomUUID()}`;
  let makeId: number;
  test.beforeAll(async () => {
    const admin = fixtureAdmin();
    const make = await admin.from("catalog_makes").insert({ name: makeName, source: "e2e", popularity_decile: 1 }).select("id").single();
    if (make.error) throw make.error;
    makeId = make.data.id;
    const model = await admin.from("catalog_models").insert({ make_id: makeId, name: "Test Coupe", source: "e2e" });
    if (model.error) throw model.error;
  });
  test.afterAll(async () => {
    await cleanupE2eUsers();
    if (makeId) { const result = await fixtureAdmin().from("catalog_makes").delete().eq("id", makeId); if (result.error) throw result.error; }
  });

  test("manual fallback creates a car and auto-names it by identity", async ({ page }) => {
    const user = makeUser("addcar-manual", Date.now());
    await signUp(page, user);
    await page.goto("/garage");
    await page.getByRole("button", { name: /add a car/i }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /enter it manually/i }).last().click();
    await dialog.getByPlaceholder("Year").fill("1987");
    await dialog.getByPlaceholder("Make").fill("Lada");
    await dialog.getByPlaceholder("Model").fill("Niva");
    // Name left blank — the car is named by what it is.
    await dialog.getByRole("button", { name: /add to garage/i }).click();
    await expect(page).toHaveURL(/\/garage\/[\w-]+\/edit/);
    await expect(page.getByLabel(/^name/i).first()).toHaveValue("1987 Lada Niva");
  });

  test("a VIN that will not decode explains itself and offers the way out", async ({ page }) => {
    const user = makeUser("addcar-vin", Date.now());
    await signUp(page, user);
    await page.goto("/garage");
    await page.getByRole("button", { name: /add a car/i }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /enter vin instead/i }).click();
    await dialog.getByLabel(/vin/i).fill("XXXXXXXXXXX");
    await dialog.getByRole("button", { name: /add to garage/i }).click();
    await expect(dialog.getByRole("alert")).toContainText(/didn't decode|doesn't look right/i);
    // The picker and manual paths stay one click away.
    await expect(dialog.getByRole("button", { name: /choose the vehicle instead/i })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /enter it manually/i }).last()).toBeVisible();
  });

  test("picker selects its catalog vehicle", async ({ page }) => {
    const user = makeUser("addcar-picker", Date.now());
    await signUp(page, user);
    await page.goto("/garage");
    await page.getByRole("button", { name: /add a car/i }).first().click();
    const dialog = page.getByRole("dialog");
    const firstMake = makeName;
    await dialog.getByRole("combobox", { name: "Make" }).fill(firstMake);
    await page.getByRole("option", { name: firstMake }).first().click();
    // Model list follows the make; take the first offered option.
    await dialog.getByRole("combobox", { name: "Model" }).click();
    const option = page.getByRole("listbox").getByRole("option").first();
    await expect(option).toBeVisible();
    const modelName = await option.textContent();
    await option.click();
    await dialog.getByRole("button", { name: /add to garage/i }).click();
    await expect(page).toHaveURL(/\/garage\/[\w-]+\/edit/);
    await expect(page.getByLabel(/^make/i).first()).toHaveValue(new RegExp(firstMake, "i"));
    expect(modelName).toBeTruthy();
  });
});
