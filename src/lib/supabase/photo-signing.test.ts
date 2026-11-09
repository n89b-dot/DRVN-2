import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sign: vi.fn(), rpc: vi.fn(), reportError: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: { from: (bucket: string) => ({ createSignedUrls: (paths: string[], expiresIn: number) => mocks.sign(bucket, paths, expiresIn) }) },
    rpc: (fn: string, args: unknown) => mocks.rpc(fn, args),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
process.env.SUPABASE_SECRET_KEY = "unit-test-key";

const { EXPORT_PHOTO_LINK_SECONDS, photoFetch, signedPhotoUrls, signPhotosForExport, signPhotosIn } = await import("./photo-signing");

const O = "https://proj.supabase.co";
const ME = "11111111-1111-4111-8111-111111111111";
const canonical = (bucket: string, file: string) => `${O}/storage/v1/object/public/${bucket}/${ME}/${file}`;
const signedFor = (bucket: string, path: string) => `${O}/storage/v1/object/sign/${bucket}/${path}?token=t-${bucket}-${path.split("/").pop()}`;

beforeEach(() => {
  vi.clearAllMocks();
  // No shared memo by default: the read finds nothing and the offer keeps this instance's URL.
  mocks.rpc.mockImplementation(async (fn: string, args: { p_signed?: unknown[] }) => ({ data: fn === "photo_signatures_offer" ? args.p_signed : [], error: null }));
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

  it("N455: a member's export links their photos for seven days, minted fresh, never from the shared window", async () => {
    const url = canonical("car-images", "export.webp");
    await signedPhotoUrls([url]);
    mocks.sign.mockClear();
    const rows = await signPhotosForExport([{ url, alt: "x" }, { avatar_url: canonical("avatars", "me.webp") }]);
    expect(rows[0]).toEqual({ url: signedFor("car-images", `${ME}/export.webp`), alt: "x" });
    expect(rows[1]).toEqual({ avatar_url: canonical("avatars", "me.webp") });
    expect(mocks.sign).toHaveBeenCalledWith("car-images", [`${ME}/export.webp`], EXPORT_PHOTO_LINK_SECONDS);
    expect(EXPORT_PHOTO_LINK_SECONDS).toBe(604_800);
  });
});

describe("one signed URL per photo per window across instances (N954, report five #117)", () => {
  const at = (minute: number) => Date.UTC(2026, 10, 10, 9, minute);

  it("uses the URL another instance already signed, without minting", async () => {
    const url = canonical("car-images", "shared-hit.webp");
    const theirs = `${O}/storage/v1/object/sign/car-images/${ME}/shared-hit.webp?token=other-instance`;
    mocks.rpc.mockImplementation(async (fn: string) => ({
      data: fn === "photo_signatures_read" ? [{ bucket: "car-images", path: `${ME}/shared-hit.webp`, signed_url: theirs }] : [],
      error: null,
    }));
    expect((await signedPhotoUrls([url], at(1))).get(url)).toBe(theirs);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("photo_signatures_read", { p_window: expect.any(Number), p_objects: [{ bucket: "car-images", path: `${ME}/shared-hit.webp` }] });
  });

  it("offers what it minted and shows the race's winner", async () => {
    const url = canonical("listing-images", "race.webp");
    const winner = `${O}/storage/v1/object/sign/listing-images/${ME}/race.webp?token=won-first`;
    mocks.rpc.mockImplementation(async (fn: string) => ({
      data: fn === "photo_signatures_offer" ? [{ bucket: "listing-images", path: `${ME}/race.webp`, signed_url: winner }] : [],
      error: null,
    }));
    expect((await signedPhotoUrls([url], at(2))).get(url)).toBe(winner);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("photo_signatures_offer", {
      p_window: expect.any(Number),
      p_signed: [{ bucket: "listing-images", path: `${ME}/race.webp`, signed_url: signedFor("listing-images", `${ME}/race.webp`) }],
    });
  });

  it("the export's fixed-life links never touch the shared memo", async () => {
    await signPhotosForExport({ url: canonical("car-images", "export-shared.webp") }, at(3));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("signs on its own, and reports once, when the shared memo is unavailable", async () => {
    mocks.rpc.mockImplementation(async () => ({ data: null, error: { message: "function public.photo_signatures_read does not exist" } }));
    const url = canonical("activity-images", "no-shared.webp");
    expect((await signedPhotoUrls([url], at(4))).get(url)).toBe(signedFor("activity-images", `${ME}/no-shared.webp`));
    expect(mocks.reportError).toHaveBeenCalledWith("[photos] shared signing memo unavailable; signing per instance", expect.anything());
  });
});

