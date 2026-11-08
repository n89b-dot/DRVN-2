import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sign: vi.fn(), reportError: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: (bucket: string) => ({ createSignedUrls: (paths: string[], expiresIn: number) => mocks.sign(bucket, paths, expiresIn) }) } }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
process.env.SUPABASE_SECRET_KEY = "sb_secret_test";

const { photoFetch, signedPhotoUrls, signPhotosIn } = await import("./photo-signing");

const O = "https://proj.supabase.co";
const ME = "11111111-1111-4111-8111-111111111111";
const canonical = (bucket: string, file: string) => `${O}/storage/v1/object/public/${bucket}/${ME}/${file}`;
const signedFor = (bucket: string, path: string) => `${O}/storage/v1/object/sign/${bucket}/${path}?token=t-${bucket}-${path.split("/").pop()}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sign.mockImplementation(async (bucket: string, paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: signedFor(bucket, path), error: null })),
    error: null,
  }));
});

describe("photo signing at the database boundary (N455)", () => {
  it("N455: signs a response's member photos in one batch per bucket and leaves avatars and other text alone", async () => {
    const rows = [
      { url: canonical("car-images", "1.webp") },
      { url: canonical("car-images", "2.webp") },
      { url: canonical("listing-images", "3.webp") },
      { avatar: canonical("avatars", "me.webp"), note: "hello" },
    ];
    const base = vi.fn(async () => new Response(JSON.stringify(rows), { headers: { "content-type": "application/json", "content-length": "999" } }));
    const res = await photoFetch(base as unknown as typeof fetch, { sign: true })(`${O}/rest/v1/car_images?select=url`, { method: "GET" });
    const out = await res.json();
    expect(out[0].url).toBe(signedFor("car-images", `${ME}/1.webp`));
    expect(out[2].url).toBe(signedFor("listing-images", `${ME}/3.webp`));
    expect(out[3]).toEqual(rows[3]);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
    expect(res.headers.get("content-length")).toBeNull();
  });

  it("N455: reuses a minted URL for the rest of its window", async () => {
    const url = canonical("activity-images", "reuse.webp");
    const now = Date.UTC(2026, 10, 8, 20, 5);
    const first = await signedPhotoUrls([url], now);
    const again = await signedPhotoUrls([url], now + 30 * 60_000);
    expect(again.get(url)).toBe(first.get(url));
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    await signedPhotoUrls([url], now + 60 * 60_000);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
  });

  it("N455: the database only ever receives canonical photo URLs, from any client", async () => {
    const base = vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } }));
    const body = JSON.stringify({ p_image_urls: [signedFor("activity-images", `${ME}/x.webp`)] });
    await photoFetch(base as unknown as typeof fetch, { sign: false })(`${O}/rest/v1/rpc/write_activity_post`, { method: "POST", body });
    const sent = JSON.parse((base.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.p_image_urls).toEqual([canonical("activity-images", "x.webp")]);
  });

  it("N455: without sign, responses stay canonical (workers and cleanup act on identities)", async () => {
    const body = JSON.stringify([{ url: canonical("car-images", "w.webp") }]);
    const base = vi.fn(async () => new Response(body, { headers: { "content-type": "application/json" } }));
    const res = await photoFetch(base as unknown as typeof fetch, { sign: false })(`${O}/rest/v1/car_images`, {});
    expect(await res.text()).toBe(body);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("N455: Storage and Auth calls, empty answers and failures pass through untouched", async () => {
    const base = vi.fn(async () => new Response(null, { status: 204 }));
    const wrapped = photoFetch(base as unknown as typeof fetch, { sign: true });
    expect((await wrapped(`${O}/rest/v1/car_images`, { method: "PATCH" })).status).toBe(204);
    await wrapped(`${O}/storage/v1/object/car-images/x`, { method: "POST", body: "raw" });
    expect((base.mock.calls[1] as unknown as [string, RequestInit])[1].body).toBe("raw");
  });

  it("N455: a photo Storage won't sign keeps its canonical URL (a missing photo, never a failed page)", async () => {
    mocks.sign.mockResolvedValue({ data: null, error: { message: "boom" } });
    const url = canonical("car-images", "fail.webp");
    await expect(signPhotosIn({ url })).resolves.toEqual({ url });
    expect(mocks.reportError).toHaveBeenCalled();
  });
});
