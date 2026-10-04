import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const fixture = vi.hoisted(() => ({ bytes: Buffer.alloc(0), user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null, staged: vi.fn(async () => ({ error: null })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: fixture.user } }) } }) }));
vi.mock("@/lib/rate-limit", () => ({ allowAction: async () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => ({ insert: fixture.staged }),
  storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example/${path}` } }), upload: async (_path: string, bytes: Buffer) => { fixture.bytes = Buffer.from(bytes); return { error: null }; } }) },
}) }));
import { POST } from "./route";
const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
function request(bytes: Uint8Array, bucket = "avatars", prefix = ME, query = bucket === "message-photos" ? "?bucket=message-photos" : "") {
  const form = new FormData(); form.set("bucket", bucket); form.set("pathPrefix", prefix);
  form.set("file", new File([Buffer.from(bytes)], "small.jpg", { type: "image/jpeg" }));
  return new Request(`http://localhost/api/media/public-photo${query}`, { method: "POST", body: form });
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
    expect((await POST(request(Buffer.from("x"), "avatars", ME, "?bucket=message-photos"))).status).toBe(400);
    expect(fixture.staged).not.toHaveBeenCalled();
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
