import { expect, test } from "@playwright/test";

import { addCar, cleanupE2eUsers, makeUser, signUp } from "./helpers";

/**
 * "What came off" (seller helpers, docs/decisions/seller-helpers.md): a new
 * mod line asks once which stock parts it replaced, and the ticked ones land
 * under "Came off this car" as stock lines that survive a reload.
 */

test.beforeEach(() => {
  test.skip(
    process.env.E2E_TEST_PROJECT_REF !== "local-drvn-remediation",
    "Creates fixture accounts — isolated local stack only"
  );
});

test.afterAll(async () => {
  await cleanupE2eUsers();
});

test("a new coilover line offers the stock parts it replaced, and they save as stock", async ({ page }) => {
  test.setTimeout(120_000);
  const user = makeUser("stock", Date.now());
  await signUp(page, user);
  await addCar(page, "Stock Parts Car");

  const editor = page.locator("section").filter({ hasText: "The build — seed the lines" });
  await editor.getByRole("button", { name: "+ Add a line manually" }).click();
  const line = editor.locator(".modrow:not(.modrow--cols):not(.modrow--off)").first();
  await line.getByLabel("Brand").fill("KW");
  await line.getByLabel("Product").fill("V3 coilovers");

  const offer = line.getByRole("group", { name: /did stock parts come off/i });
  await expect(offer).toBeVisible();
  await offer.getByLabel("Stock springs ×4").check();
  await offer.getByLabel("Stock shocks ×4").check();
  await offer.getByRole("button", { name: "Add to Came off" }).click();
  await expect(offer).toBeHidden();

  await editor.getByRole("button", { name: "Save the build" }).click();
  await expect(editor.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  await page.reload();
  const cameOff = editor.locator(".modrow--off");
  await expect(cameOff).toHaveCount(2);
  await expect(cameOff.filter({ hasText: "Stock springs ×4" })).toContainText("Stock · Off since");
  await expect(cameOff.filter({ hasText: "Stock shocks ×4" }).getByRole("button", { name: "List it" })).toBeVisible();
  // Asked once: the saved coilover line doesn't ask again.
  await expect(editor.getByRole("group", { name: /did stock parts come off/i })).toHaveCount(0);
});

test("a line the name can't place asks what it is, and 'Nothing came off' closes it", async ({ page }) => {
  test.setTimeout(120_000);
  const user = makeUser("stockpick", Date.now());
  await signUp(page, user);
  await addCar(page, "Stock Pick Car");

  const editor = page.locator("section").filter({ hasText: "The build — seed the lines" });
  await editor.getByRole("button", { name: "+ Add a line manually" }).click();
  const line = editor.locator(".modrow:not(.modrow--cols):not(.modrow--off)").first();
  await line.getByLabel("Brand").fill("Mystery");
  await line.getByLabel("Product").fill("Widget 3000");

  const ask = line.getByRole("group", { name: /did stock parts come off/i });
  await expect(ask).toContainText("What is it?");
  await ask.getByRole("button", { name: "Wheels" }).click();
  await expect(ask.getByLabel("Stock wheels ×4")).toBeVisible();
  await ask.getByRole("button", { name: "Nothing came off" }).click();
  await expect(ask).toBeHidden();
});
