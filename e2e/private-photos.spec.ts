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
  test.setTimeout(240_000);
  const admin = fixtureAdmin();
  const storage = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const tag = randomUUID().slice(0, 8);
  const email = `e2e-photos-${randomUUID()}@drvn.test`;
  const user = await admin.auth.admin.createUser({ email, password: `Photos-${randomUUID()}!`, email_confirm: true });
  if (user.error) throw user.error;
  const id = user.data.user.id;
  const { default: sharp } = await import("sharp");
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "orange" } }).webp().toBuffer();
  const paths = {
    privateCar: `${id}/private-${tag}.webp`,
    publicCar: `${id}/public-${tag}.webp`,
    draft: `${id}/draft-${tag}.webp`,
    // A second shown car, whose page nobody opens until its photo has a copy.
    copied: `${id}/copied-${tag}.webp`,
  };
  const canonical = (bucket: string, path: string) => `${storage}/storage/v1/object/public/${bucket}/${path}`;
  // 20261124220000: a published photo's copy, in the public twin of its bucket.
  const copyOf = (bucket: string, path: string) => `${storage}/storage/v1/object/public/public-${bucket}/${path}`;
  const copyState = async (bucket: string, path: string) => {
    const row = await admin.from("public_photo_copies").select("state").eq("bucket", bucket).eq("path", path).maybeSingle();
    if (row.error) throw row.error;
    return row.data?.state ?? null;
  };
  // The media job is what makes and withdraws copies. It works through
  // everyone's photos a batch at a time, so it is run until this one is done.
  const runMediaJob = () => request.post("/api/jobs/media-gc", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  try {
    const named = await admin.from("profiles").update({ username: `photos${tag}` }).eq("id", id);
    if (named.error) throw named.error;
    for (const [bucket, path] of [["car-images", paths.privateCar], ["car-images", paths.publicCar], ["car-images", paths.copied], ["listing-images", paths.draft]] as const) {
      const upload = await admin.storage.from(bucket).upload(path, bytes, { contentType: "image/webp" });
      if (upload.error) throw upload.error;
    }
    const cars = await admin
      .from("cars")
      .insert([
        { owner_id: id, slug: `private-photos-${tag}`, name: "Hidden build", is_public: false, cover_image_url: canonical("car-images", paths.privateCar) },
        { owner_id: id, slug: `public-photos-${tag}`, name: "Shown build", is_public: true, cover_image_url: canonical("car-images", paths.publicCar) },
        { owner_id: id, slug: `copied-photos-${tag}`, name: "Copied build", is_public: true, cover_image_url: canonical("car-images", paths.copied) },
      ])
      .select("id, slug, is_public");
    if (cars.error) throw cars.error;
    const privateCar = cars.data.find((car) => !car.is_public)!;
    const publicCar = cars.data.find((car) => car.slug === `public-photos-${tag}`)!;
    const copiedCar = cars.data.find((car) => car.slug === `copied-photos-${tag}`)!;
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
    // The private car's page is the not-found page (#105). Next streams the
    // page, so a notFound() thrown after the first byte keeps the 200 it had
    // already sent: assert what a visitor sees, the not-found page itself,
    // and that neither the photo nor the car's name is anywhere in it.
    await page.goto(`/cars/${privateCar.slug}`);
    await expect(page).toHaveTitle("Car not found - DRVN");
    await expect(page.getByText("Nothing at this address.")).toBeVisible();
    const privatePage = await page.content();
    expect(privatePage).not.toContain(paths.privateCar);
    expect(privatePage).not.toContain("Hidden build");

    // The public car's photo renders: through a signed URL, or through its
    // public copy if the media job has already made one.
    await page.goto(`/cars/${publicCar.slug}`);
    const cover = page.locator('img[src*="object%2Fsign%2Fcar-images"], img[src*="/object/sign/car-images/"], img[src*="public-car-images"]').first();
    await expect(cover).toBeVisible();
    await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout: 20_000 }).toBe(true);
    const html = await page.content();
    expect(html).not.toContain(paths.privateCar);
    expect(html).not.toContain(`/object/public/car-images/${paths.publicCar}`);

    // 20261124220000: a shown photo gets a public copy, whose address does
    // not change; a private car's and a draft's never do.
    await expect
      .poll(async () => { await runMediaJob(); return copyState("car-images", paths.copied); }, { timeout: 120_000, intervals: [500, 2_000, 5_000] })
      .toBe("live");
    expect((await request.get(copyOf("car-images", paths.copied))).status()).toBe(200);
    for (const [bucket, path] of [["car-images", paths.privateCar], ["listing-images", paths.draft]] as const) {
      expect(await copyState(bucket, path), `${bucket}/${path} has a copy`).toBeNull();
      const response = await request.get(copyOf(bucket, path));
      expect([400, 404], `${copyOf(bucket, path)} answered ${response.status()}`).toContain(response.status());
    }
    // What the signer is told from now on is the copy's address, and only for
    // the shown photo. (Asked of the database, not read off the page: a list
    // another test opened may have shown this car before its copy was made,
    // and the server keeps handing out that signed link until the hour turns.)
    const told = await admin.rpc("photo_signatures_read", {
      p_window: 1,
      p_objects: [{ bucket: "car-images", path: paths.copied }, { bucket: "car-images", path: paths.privateCar }],
    });
    if (told.error) throw told.error;
    expect(told.data).toEqual([{ bucket: "car-images", path: paths.copied, signed_url: copyOf("car-images", paths.copied) }]);
    // The car's page shows the photo, and the optimiser serves the copy.
    await page.goto(`/cars/${copiedCar.slug}`);
    const copied = page.locator('img[src*="public-car-images"], img[src*="object%2Fsign%2Fcar-images"], img[src*="/object/sign/car-images/"]').first();
    await expect(copied).toBeVisible();
    await expect.poll(() => copied.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout: 20_000 }).toBe(true);
    const resized = `/_next/image?url=${encodeURIComponent(copyOf("car-images", paths.copied))}&w=640&q=75`;
    expect((await request.get(resized)).status()).toBe(200);

    // Hidden: the copy is withdrawn. Its address stops opening, its record
    // goes, and the optimiser refuses a resized copy it may still hold.
    const hidden = await admin.from("cars").update({ is_public: false }).eq("id", copiedCar.id);
    if (hidden.error) throw hidden.error;
    await expect
      .poll(async () => { await runMediaJob(); return copyState("car-images", paths.copied); }, { timeout: 120_000, intervals: [500, 2_000, 5_000] })
      .toBeNull();
    const gone = await request.get(copyOf("car-images", paths.copied));
    expect([400, 404], `the withdrawn copy answered ${gone.status()}`).toContain(gone.status());
    // The image gate remembers an answer for fifteen seconds.
    await expect.poll(async () => (await request.get(resized)).status(), { timeout: 40_000, intervals: [1_000, 3_000] }).toBe(404);
    // The owner's own photo is untouched: only the copy went.
    expect((await admin.storage.from("car-images").download(paths.copied)).error).toBeNull();
  } finally {
    await admin.storage.from("car-images").remove([paths.privateCar, paths.publicCar, paths.copied]);
    await admin.storage.from("listing-images").remove([paths.draft]);
    await admin.storage.from("public-car-images").remove([paths.publicCar, paths.copied]);
    await admin.from("public_photo_copies").delete().eq("owner_id", id);
    await admin.from("revoked_photo_copies").delete().like("object_key", `public-car-images/${id}/%`);
    await cleanupFixtureUser(id);
  }
});
