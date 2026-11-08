import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { cleanupFixtureUser, fixtureAdmin } from "./fixtures";

/** The files in a ZIP, read from its central directory (N47: the export is one archive). */
function unzip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    const packed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    files.set(name, inflateRawSync(zip.subarray(dataAt, dataAt + packed)));
    at += 46 + nameLength;
  }
  return files;
}

test("queued account export crosses media pages without including another member's images", async ({ page }) => {
  test.setTimeout(240_000);
  const admin = fixtureAdmin();
  const password = `Export-${randomUUID()}!`;
  const email = `e2e-export-${randomUUID()}@drvn.test`;
  const own = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (own.error) throw own.error;
  const other = await admin.auth.admin.createUser({
    email: `e2e-export-other-${randomUUID()}@drvn.test`,
    email_confirm: true,
  });
  if (other.error) throw other.error;
  let requestId: string | undefined;

  try {
    const named = await admin
      .from("profiles")
      .update({ username: `export${randomUUID().replaceAll("-", "").slice(0, 18)}` })
      .eq("id", own.data.user.id);
    if (named.error) throw named.error;
    const cars = await admin.from("cars").insert([
      {
        owner_id: own.data.user.id,
        slug: `export-${randomUUID()}`,
        name: "Export fixture",
        is_public: false,
      },
      {
        owner_id: other.data.user.id,
        slug: `export-${randomUUID()}`,
        name: "Counterparty fixture",
        is_public: true,
      },
    ]).select("id,owner_id");
    if (cars.error) throw cars.error;
    const ownCar = cars.data.find((car) => car.owner_id === own.data.user.id)!.id;
    const otherCar = cars.data.find((car) => car.owner_id === other.data.user.id)!.id;
    const imageUrl = (id: string, index: number) =>
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/car-images/${id}/export-${index}.webp`;
    const images = await admin.from("car_images").insert(
      Array.from({ length: 501 }, (_, index) => ({
        car_id: ownCar,
        url: imageUrl(own.data.user.id, index),
        position: index,
      }))
    );
    if (images.error) throw images.error;
    const foreignImage = await admin.from("car_images").insert({
      car_id: otherCar,
      url: imageUrl(other.data.user.id, 0),
      position: 0,
    });
    if (foreignImage.error) throw foreignImage.error;

    await page.goto("/login");
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /log in|sign in/i }).click();
    await page.waitForURL(/\/home/);

    const queuedResponse = await page.request.post("/api/account/export");
    const queued = await queuedResponse.json();
    expect(queuedResponse.status(), JSON.stringify(queued)).toBe(202);
    expect(queued).toMatchObject({ status: "pending" });
    requestId = queued.id;

    let latest: { id: string; status: string; download_url: string | null } | null = null;
    for (let attempt = 0; attempt < 20 && latest?.status !== "completed"; attempt++) {
      const worker = await page.request.post("/api/jobs/account-deletions", {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
      expect(worker.status(), await worker.text()).toBe(200);
      const statusResponse = await page.request.get("/api/account/export");
      expect(statusResponse.status()).toBe(200);
      latest = (await statusResponse.json()).request;
      expect(latest?.id).toBe(requestId);
    }
    expect(latest).toMatchObject({ id: requestId, status: "completed" });
    expect(latest?.download_url).toBe(`/api/account/export/${requestId}/download`);

    const download = await page.request.get(latest!.download_url!);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toContain("attachment;");
    expect(download.headers()["content-disposition"]).toContain(".zip");
    expect(download.headers()["content-type"]).toBe("application/zip");
    // One archive with everything in it: no links that expire (N47).
    const files = unzip(Buffer.from(await download.body()));
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8")) as {
      requester: { id: string };
      counts: Record<string, number>;
      files: Array<{ file: string; section: string; rows: number }>;
    };
    expect(manifest.requester.id).toBe(own.data.user.id);
    expect(manifest.counts.car_images).toBe(501);
    expect(manifest.counts.payments).toBe(0);
    expect(JSON.stringify(manifest)).not.toContain("download_url");
    expect(manifest.files.every((file) => files.has(file.file))).toBe(true);

    const carParts = manifest.files.filter((file) => file.section === "car_images");
    expect(carParts.reduce((total, part) => total + part.rows, 0)).toBe(501);
    const packages = carParts.map((part) => JSON.parse(files.get(part.file)!.toString("utf8")) as { rows: Array<{ car_id: string }> });
    const exportedImages = packages.flatMap((part) => part.rows);
    expect(exportedImages).toHaveLength(501);
    expect(exportedImages.every((image) => image.car_id === ownCar)).toBe(true);
    expect(JSON.stringify({ manifest, exportedImages })).not.toContain(other.data.user.id);
    expect(JSON.stringify({ manifest, exportedImages })).not.toContain(otherCar);
  } finally {
    if (requestId) {
      const parts = await admin
        .from("account_export_parts")
        .select("object_path")
        .eq("request_id", requestId);
      if (parts.error) throw parts.error;
      for (let offset = 0; offset < parts.data.length; offset += 100) {
        const removed = await admin.storage
          .from("account-exports")
          .remove(parts.data.slice(offset, offset + 100).map((part) => part.object_path));
        if (removed.error) throw removed.error;
      }
    }
    await cleanupFixtureUser(own.data.user.id);
    await cleanupFixtureUser(other.data.user.id);
  }
});
