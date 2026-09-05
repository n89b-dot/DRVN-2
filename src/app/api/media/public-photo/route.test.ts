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
function request(bytes: Uint8Array) {
  const form = new FormData(); form.set("bucket", "avatars"); form.set("pathPrefix", "11111111-1111-4111-8111-111111111111");
  form.set("file", new File([Buffer.from(bytes)], "small.jpg", { type: "image/jpeg" }));
  return new Request("http://localhost/api/media/public-photo", { method: "POST", body: form });
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
  it("requires authentication before reading bytes", async () => {
    fixture.user = null;
    expect((await POST(request(Buffer.from("anything")))).status).toBe(401);
    expect(fixture.staged).not.toHaveBeenCalled();
  });
});
