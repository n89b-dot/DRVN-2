import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

/**
 * N455 (remediation plan C4, 20261108160000): a private car's photos and a
 * draft listing's photos used to open for anyone holding their URL. The
 * photo buckets are private now; a photo is shown through a signed URL minted
 * only after its row was read under the reader's own row policies.
 */
test("N455: a private car's photo and a draft listing's photo are refused to a visitor, while a public car's photo renders signed", async ({ page, request }) => {
  test.setTimeout(120_000);
  const admin = fixtureAdmin();
  const storage = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const tag = randomUUID().slice(0, 8);
  const email = `e2e-photos-${randomUUID()}@drvn.test`;
  const user = await admin.auth.admin.createUser({ email, password: `Photos-${randomUUID()}!`, email_confirm: true });
  if (user.error) throw user.error;
  const id = user.data.user.id;
  const { default: sharp } = await import("sharp");
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "orange" } }).webp().toBuffer();
  const paths = { privateCar: `${id}/private-${tag}.webp`, publicCar: `${id}/public-${tag}.webp`, draft: `${id}/draft-${tag}.webp` };
  const canonical = (bucket: string, path: string) => `${storage}/storage/v1/object/public/${bucket}/${path}`;
  try {
    const named = await admin.from("profiles").update({ username: `photos${tag}` }).eq("id", id);
    if (named.error) throw named.error;
    for (const [bucket, path] of [["car-images", paths.privateCar], ["car-images", paths.publicCar], ["listing-images", paths.draft]] as const) {
      const upload = await admin.storage.from(bucket).upload(path, bytes, { contentType: "image/webp" });
      if (upload.error) throw upload.error;
    }
    const cars = await admin
      .from("cars")
      .insert([
        { owner_id: id, slug: `private-photos-${tag}`, name: "Hidden build", is_public: false, cover_image_url: canonical("car-images", paths.privateCar) },
        { owner_id: id, slug: `public-photos-${tag}`, name: "Shown build", is_public: true, cover_image_url: canonical("car-images", paths.publicCar) },
      ])
      .select("id, slug, is_public");
    if (cars.error) throw cars.error;
    const privateCar = cars.data.find((car) => !car.is_public)!;
    const publicCar = cars.data.find((car) => car.is_public)!;
    const photos = await admin.from("car_images").insert([
      { car_id: privateCar.id, position: 0, url: canonical("car-images", paths.privateCar) },
      { car_id: publicCar.id, position: 0, url: canonical("car-images", paths.publicCar) },
    ]);
    if (photos.error) throw photos.error;
    const listing = await admin
      .from("listings")
      .insert({ seller_id: id, title: `Draft photos ${tag}`, category: "performance", price_cents: 10_000, shipping_cents: 0, currency: "USD", status: "draft" })
      .select("id")
      .single();
    if (listing.error) throw listing.error;
    const listingPhoto = await admin.from("listing_images").insert({ listing_id: listing.data.id, position: 0, url: canonical("listing-images", paths.draft) });
    if (listingPhoto.error) throw listingPhoto.error;

    // A visitor holding the stored URLs gets neither photo (the bucket is private).
    for (const url of [canonical("car-images", paths.privateCar), canonical("listing-images", paths.draft)]) {
      const response = await request.get(url);
      expect([400, 403, 404], `${url} answered ${response.status()}`).toContain(response.status());
    }
    // Nor through the optimiser, nor through the pages.
    const optimised = await request.get(`/_next/image?url=${encodeURIComponent(canonical("car-images", paths.privateCar))}&w=640&q=75`);
    expect(optimised.ok()).toBe(false);
    expect((await request.get(`/cars/${privateCar.slug}`)).status()).toBe(404);

    // The public car's photo renders, through a signed URL.
    await page.goto(`/cars/${publicCar.slug}`);
    const cover = page.locator('img[src*="object%2Fsign%2Fcar-images"], img[src*="/object/sign/car-images/"]').first();
    await expect(cover).toBeVisible();
    await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout: 20_000 }).toBe(true);
    const html = await page.content();
    expect(html).not.toContain(paths.privateCar);
    expect(html).not.toContain(`/object/public/car-images/${paths.publicCar}`);
  } finally {
    await admin.storage.from("car-images").remove([paths.privateCar, paths.publicCar]);
    await admin.storage.from("listing-images").remove([paths.draft]);
    await cleanupFixtureUser(id);
  }
});
