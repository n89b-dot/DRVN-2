import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { fixtureAdmin, cleanupFixtureUser } from "./fixtures";
test("account export crosses a media page without including another member's images", async ({ page }) => {
  const admin = fixtureAdmin(), password = `Export-${randomUUID()}!`, email = `e2e-export-${randomUUID()}@drvn.test`;
  const own = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (own.error) throw own.error;
  const other = await admin.auth.admin.createUser({ email: `e2e-export-other-${randomUUID()}@drvn.test`, email_confirm: true }); if (other.error) throw other.error;
  try {
    const named = await admin.from("profiles").update({ username: `export${randomUUID().replaceAll("-", "").slice(0, 18)}` }).eq("id", own.data.user.id); if (named.error) throw named.error;
    const cars = await admin.from("cars").insert([
      { owner_id: own.data.user.id, slug: `export-${randomUUID()}`, name: "Export fixture", is_public: false },
      { owner_id: other.data.user.id, slug: `export-${randomUUID()}`, name: "Counterparty fixture", is_public: true },
    ]).select("id,owner_id"); if (cars.error) throw cars.error;
    const ownCar = cars.data.find(x => x.owner_id === own.data.user.id)!.id;
    const otherCar = cars.data.find(x => x.owner_id === other.data.user.id)!.id;
    const imageUrl = (id: string, n: number) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/car-images/${id}/export-${n}.webp`;
    const images = await admin.from("car_images").insert(Array.from({ length: 501 }, (_, i) => ({ car_id: ownCar, url: imageUrl(own.data.user.id, i), position: i }))); if (images.error) throw images.error;
    const privateImage = await admin.from("car_images").insert({ car_id: otherCar, url: imageUrl(other.data.user.id, 0), position: 0 }); if (privateImage.error) throw privateImage.error;
    await page.goto("/login"); await page.getByLabel(/^email$/i).fill(email); await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click(); await page.waitForURL(/\/home/);
    const response = await page.request.get("/api/account/export");
    const exported = await response.json(); expect(response.status(), JSON.stringify(exported.failed_sections)).toBe(200);
    expect(exported.media.cars).toHaveLength(501);
    expect(exported.media.cars.every((image: { car_id: string }) => image.car_id === ownCar)).toBe(true);
    expect(exported.payment_history).toEqual([]);
  } finally { await cleanupFixtureUser(own.data.user.id); await cleanupFixtureUser(other.data.user.id); }
});
