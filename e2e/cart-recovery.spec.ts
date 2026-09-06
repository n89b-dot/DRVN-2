import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createDiscoveryFixture } from "./fixtures";

test("full cart explains capacity and repeated add/remove persists one desired state", async ({ page, context, baseURL }) => {
  const fixture = await createDiscoveryFixture();
  try {
    await context.addCookies([{ name: "drvn_cart", value: JSON.stringify(Array.from({ length: 50 }, () => randomUUID())), url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    await page.goto(fixture.listingPath);
    await page.getByRole("button", { name: /add to cart/i }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Your cart is full");
    await context.clearCookies({ name: "drvn_cart" });
    await page.reload();
    await page.getByRole("button", { name: /add to cart/i }).click();
    await expect(page.getByRole("link", { name: /in cart.*view cart/i })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /add to cart/i }).click();
    await expect(page.getByRole("link", { name: /in cart.*view cart/i })).toBeVisible();
    const cart = (await context.cookies()).find((cookie) => cookie.name === "drvn_cart");
    expect(JSON.parse(decodeURIComponent(cart!.value))).toEqual([fixture.listingPath.split("/").at(-1)]);
    await page.goto("/cart");
    await page.getByRole("button", { name: /remove/i }).click();
    await expect.poll(async () => JSON.parse(decodeURIComponent((await context.cookies()).find((cookie) => cookie.name === "drvn_cart")?.value ?? "[]"))).toEqual([]);
    await page.reload();
    await expect(page.getByRole("button", { name: /remove/i })).toHaveCount(0);
  } finally { await fixture.cleanup(); }
});
