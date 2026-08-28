import { expect, test } from "@playwright/test";

import { cleanupE2eUsers, makeUser, signUp } from "./helpers";

/**
 * Canonical Add Car (brief §E): picker primary, VIN secondary, manual always
 * available. The picker cases self-skip when the catalog is unseeded (a fresh
 * disposable project) — the manual and VIN paths must work everywhere.
 */

test.describe("Add Car", () => {
  test.afterAll(async () => {
    await cleanupE2eUsers();
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

  test("picker selects a catalog vehicle (skips on an unseeded catalog)", async ({ page, request }) => {
    const catalog = await request.get("/api/vehicles/catalog/makes");
    const { makes } = await catalog.json();
    test.skip(!makes?.length, "vehicle catalog not seeded in this environment");

    const user = makeUser("addcar-picker", Date.now());
    await signUp(page, user);
    await page.goto("/garage");
    await page.getByRole("button", { name: /add a car/i }).first().click();
    const dialog = page.getByRole("dialog");
    const firstMake = makes[0].name as string;
    await dialog.getByRole("combobox", { name: "Make" }).fill(firstMake.slice(0, 4));
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
