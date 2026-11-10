import { afterEach, describe, expect, it, vi } from "vitest";

// A module of its own: photoSigningReady() remembers its answer per process.
const mocks = vi.hoisted(() => ({ sign: vi.fn(), rpc: vi.fn(), reportError: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: { from: (bucket: string) => ({ createSignedUrls: (paths: string[], expiresIn: number) => mocks.sign(bucket, paths, expiresIn) }) },
    rpc: (fn: string, args: unknown) => ({ abortSignal: () => mocks.rpc(fn, args) }),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
process.env.SUPABASE_SECRET_KEY = "unit-test-key";

const { photoFetch, signPhotosForExport } = await import("./photo-signing");
const { tableContext } = await import("@/lib/photo-urls");

const O = "https://proj.supabase.co";
const ME = "11111111-1111-4111-8111-111111111111";
const photo = `${O}/storage/v1/object/public/car-images/${ME}/cover.webp`;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const read = async (request: string, value: unknown) =>
  (await photoFetch((async () => json(value)) as unknown as typeof fetch, { sign: true })(`${O}/rest/v1/${request}`, { method: "GET" })).json();

afterEach(() => { vi.useRealTimers(); });

describe("the signer signs nothing until the database guards are there (N940, #196 review P2-2)", () => {
  it("signs nothing, and says so once, while photo_signing_ready is false or fails; signs once it is true", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 12, 9, 0) });
    mocks.sign.mockImplementation(async (bucket: string, paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `${O}/storage/v1/object/sign/${bucket}/${path}?token=t`, error: null })), error: null }));
    mocks.rpc.mockImplementation(async (fn: string) => ({ data: fn === "photo_signing_ready" ? false : [], error: null }));

    expect((await read("cars?select=cover_image_url", [{ cover_image_url: photo }]))[0].cover_image_url).toBe(photo);
    expect(await signPhotosForExport([{ cover_image_url: photo }], ME, tableContext("cars", "cover_image_url"))).toEqual([{ cover_image_url: photo }]);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledTimes(1);
    expect(mocks.reportError).toHaveBeenCalledWith(expect.stringContaining("photo guards are missing"), expect.objectContaining({ reason: "not-ready" }));
    // Remembered for thirty seconds: no second question.
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    // A failed check is not ready either.
    vi.advanceTimersByTime(31_000);
    mocks.rpc.mockImplementation(async () => ({ data: null, error: { message: "function public.photo_signing_ready() does not exist" } }));
    expect((await read("cars?select=cover_image_url", [{ cover_image_url: photo }]))[0].cover_image_url).toBe(photo);
    expect(mocks.sign).not.toHaveBeenCalled();

    // Applied: signing starts on the next check.
    vi.advanceTimersByTime(31_000);
    mocks.rpc.mockImplementation(async (fn: string) => ({ data: fn === "photo_signing_ready" ? true : [], error: null }));
    expect((await read("cars?select=cover_image_url", [{ cover_image_url: photo }]))[0].cover_image_url).toContain("/object/sign/");
  });

  it("reports a read it can't place at most once per ten minutes per reason", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 12, 11, 0) });
    mocks.reportError.mockClear();
    for (let i = 0; i < 3; i++) await read("car_images?select=url(", [{ url: photo }]);
    await read("car_images?select=url&select=id", [{ url: photo }]);
    const res = await photoFetch((async () => json([{ url: photo }])) as unknown as typeof fetch, { sign: true })(`${O}/rest/v1/car_images?select=url`, { headers: { "Accept-Profile": "private" } });
    expect((await res.json())[0].url).toBe(photo);
    expect(mocks.reportError.mock.calls.map((c) => (c[1] as { reason: string }).reason)).toEqual(["unparsable-select", "two-selects", "non-public-profile"]);
    vi.advanceTimersByTime(10 * 60_000 + 1);
    await read("car_images?select=url(", [{ url: photo }]);
    expect(mocks.reportError).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ reason: "unparsable-select", since: 2 }));
    // Storage and Auth answers are not "reads it can't place".
    mocks.reportError.mockClear();
    await photoFetch((async () => json({})) as unknown as typeof fetch, { sign: true })(`${O}/auth/v1/user`, {});
    expect(mocks.reportError).not.toHaveBeenCalled();
  });
});
