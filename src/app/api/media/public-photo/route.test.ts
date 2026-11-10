import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const fixture = vi.hoisted(() => ({ bytes: Buffer.alloc(0), user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null, staged: vi.fn(async () => ({ error: null })), origin: vi.fn(async () => ({ error: null })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: fixture.user } }) } }) }));
vi.mock("@/lib/rate-limit", () => ({ allowAction: async () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => (table === "job_config" ? { upsert: fixture.origin } : { insert: fixture.staged }),
  storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } }), upload: async (_path: string, bytes: Buffer) => { fixture.bytes = Buffer.from(bytes); return { error: null }; } }) },
}) }));
import { POST } from "./route";
const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
function request(bytes: Uint8Array, bucket = "avatars", prefix = ME, target = bucket === "message-photos" ? "message-photos" : "", name = "small.jpg", type = "image/jpeg") {
  const form = new FormData(); form.set("bucket", bucket); form.set("pathPrefix", prefix);
  form.set("file", new File([Buffer.from(bytes)], name, { type }));
  return new Request("http://localhost/api/media/public-photo", {
    method: "POST",
    body: form,
    headers: target ? { "x-upload-bucket": target } : {},
  });
}
async function gpsPhoto() {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } })
    .jpeg().withExifMerge({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" } }).toBuffer();
}
beforeEach(() => { fixture.user = { id: "11111111-1111-4111-8111-111111111111" }; fixture.bytes = Buffer.alloc(0); fixture.staged.mockClear(); });
describe("public photo trust boundary", () => {
  it("re-encodes even a small image and removes metadata", async () => {
    const source = await sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } }).jpeg().withMetadata().toBuffer();
    expect((await sharp(source).metadata()).exif).toBeDefined();
    expect((await POST(request(source))).status).toBe(200);
    const result = await sharp(fixture.bytes).metadata();
    expect(result.format).toBe("webp"); expect(result.exif).toBeUndefined(); expect(result.icc).toBeUndefined();
    expect(fixture.staged).toHaveBeenCalledOnce();
  });
  it("records the storage origin the database checks member photo URLs against (N55)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
    fixture.origin.mockClear();
    const source = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).jpeg().toBuffer();
    expect((await POST(request(source))).status).toBe(200);
    expect(fixture.origin).toHaveBeenCalledWith(
      { key: "media_storage_origin", value: "https://proj.supabase.co" },
      { onConflict: "key", ignoreDuplicates: true }
    );
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });
  it("rejects forged image content without publishing anything", async () => {
    expect((await POST(request(Buffer.from("not an image")))).status).toBe(422);
    expect(fixture.bytes.length).toBe(0); expect(fixture.staged).not.toHaveBeenCalled();
  });
  it("re-encodes a small message photo and strips its location", async () => {
    const source = await gpsPhoto();
    // 0x8825 is the GPS IFD pointer tag (little-endian in Sharp's output).
    expect((await sharp(source).metadata()).exif?.includes(Buffer.from([0x25, 0x88]))).toBe(true);
    const response = await POST(request(source, "message-photos", `${ME}/${THEM}`));
    expect(response.status).toBe(200);
    expect((await response.json()).path).toMatch(new RegExp(`^${ME}/${THEM}/[0-9a-f-]+\\.webp$`));
    const result = await sharp(fixture.bytes).metadata();
    expect(result.format).toBe("webp"); expect(result.exif).toBeUndefined();
  });
  it("only writes message photos into the sender's folder for one other member", async () => {
    for (const prefix of [`${THEM}/${ME}`, ME, `${ME}/${ME}`, `${ME}/${THEM}/extra`, `${ME}/not-a-member`]) {
      expect((await POST(request(Buffer.from("x"), "message-photos", prefix))).status, prefix).toBe(400);
    }
    // The body's bucket must match the one the limit was chosen for.
    expect((await POST(request(Buffer.from("x"), "message-photos", `${ME}/${THEM}`, ""))).status).toBe(400);
    expect((await POST(request(Buffer.from("x"), "avatars", ME, "message-photos"))).status).toBe(400);
    expect(fixture.staged).not.toHaveBeenCalled();
  });
  it("R81: a chat photo goes to the private bucket, re-encoded, unlisted and with no public URL", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
    const response = await POST(request(await gpsPhoto(), "agent-chat-photos", ME));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.path).toMatch(new RegExp(`^${ME}/[0-9a-f-]{36}\\.webp$`));
    expect(body.url).toBe(`https://proj.supabase.co/storage/v1/object/authenticated/agent-chat-photos/${body.path}`);
    expect(body.url).not.toContain("/object/public/");
    expect((await sharp(fixture.bytes).metadata()).exif).toBeUndefined();
    // Not on the public staging ledger: the agent sweep owns chat photos.
    expect(fixture.staged).not.toHaveBeenCalled();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });
  it("R81: chat photos go only into the uploader's own top folder", async () => {
    const source = await gpsPhoto();
    expect((await POST(request(source, "agent-chat-photos", THEM))).status).toBe(400);
    expect((await POST(request(source, "agent-chat-photos", `${ME}/${THEM}`))).status).toBe(400);
  });
  it("still refuses buckets it doesn't normalise, including evidence", async () => {
    expect((await POST(request(Buffer.from("x"), "dispute-evidence", ME))).status).toBe(400);
  });
  it("requires authentication before reading bytes", async () => {
    fixture.user = null;
    expect((await POST(request(Buffer.from("anything")))).status).toBe(401);
    expect(fixture.staged).not.toHaveBeenCalled();
  });
});

/**
 * N64: iPhones save HEIC — HEIF holding HEVC. These are real files (made with
 * macOS `sips`, 64×48): one HEVC, as an iPhone takes, and one AVIF, the other
 * thing HEIF holds. The route must decode what the bundled image library can,
 * and give a clear, actionable refusal for what it can't — never the generic
 * "could not be safely processed". Whether the DEPLOYED runtime's sharp
 * decodes HEVC is the owner's hosted check; this pins the code path.
 */
describe("HEIC and HEIF uploads", () => {
  const sample = (name: string) => readFileSync(join(__dirname, "__fixtures__", name));

  it("reads an iPhone HEIC as HEVC-in-HEIF, which the bundled sharp cannot decode", async () => {
    const meta = await sharp(sample("iphone-hevc.heic")).metadata();
    expect(meta.format).toBe("heif");
    expect(meta.compression).toBe("hevc");
    // Prebuilt sharp ships libheif without an HEVC decoder. If this starts
    // passing a decode, the refusal below is no longer needed.
    await expect(sharp(sample("iphone-hevc.heic")).webp().toBuffer()).rejects.toThrow(/HEVC|compression format/i);
  });

  it("refuses an undecodable HEIC with words the uploader can act on, publishing nothing", async () => {
    const response = await POST(request(sample("iphone-hevc.heic"), "car-images", ME, "", "IMG_0001.HEIC", "image/heic"));
    expect(response.status).toBe(415);
    expect((await response.json()).error).toMatch(/HEIC photo can't be processed.*JPEG/);
    expect(fixture.bytes.length).toBe(0);
    expect(fixture.staged).not.toHaveBeenCalled();
  });

  it("decodes and re-encodes an AVIF-in-HEIF photo", async () => {
    const response = await POST(request(sample("av1.avif"), "car-images", ME, "", "photo.avif", "image/avif"));
    expect(response.status).toBe(200);
    expect((await sharp(fixture.bytes).metadata()).format).toBe("webp");
  });
});

describe("N955: the photo route refuses what a serverless host would drop without a word (work review #158)", () => {
  /** A real JPEG padded with trailing bytes to an exact size: decoders ignore what follows the image. */
  async function jpegOf(bytes: number) {
    const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } }).jpeg().toBuffer();
    return Buffer.concat([image, Buffer.alloc(bytes - image.length)]);
  }
  const MB = 1024 * 1024;

  it("answers 413 with no body for a photo one byte over 4 MB, and publishes nothing", async () => {
    const response = await POST(request(await jpegOf(4 * MB + 1), "listing-images"));
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("");
    expect(fixture.bytes.length).toBe(0);
    expect(fixture.staged).not.toHaveBeenCalled();
  });

  it("takes a photo of exactly 4 MB", async () => {
    expect((await POST(request(await jpegOf(4 * MB), "listing-images"))).status).toBe(200);
    expect(fixture.staged).toHaveBeenCalledOnce();
  });

  it("holds a profile photo to its own 2 MB, whatever the general limit", async () => {
    expect((await POST(request(await jpegOf(2 * MB + 1), "avatars"))).status).toBe(413);
    expect((await POST(request(await jpegOf(2 * MB), "avatars"))).status).toBe(200);
  });

  it("refuses on the declared length alone, before reading a byte, and again if the body outgrows the limit", async () => {
    const declared = new Request("http://localhost/api/media/public-photo", { method: "POST", body: "x", headers: { "content-length": String(4 * MB + 256 * 1024 + 1) } });
    expect((await POST(declared)).status).toBe(413);
    // No honest length: the stream is counted as it is read.
    const oversized = request(await jpegOf(5 * MB), "listing-images");
    expect(oversized.headers.get("content-length")).toBeNull();
    expect((await POST(oversized)).status).toBe(413);
    expect(fixture.bytes.length).toBe(0);
  });
});
