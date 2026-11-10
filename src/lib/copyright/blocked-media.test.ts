import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), reportError: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  // The list is read a page at a time by key (N718): select → order → limit, then gt(after).
  createClient: () => ({
    from: () => ({
      select: () => ({
        order: () => ({
          limit: (size: number) => ({
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(mocks.select(null, size)).then(resolve, reject),
            gt: (_col: string, after: string) => mocks.select(after, size),
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/env", () => ({ requireServerEnv: () => ({ url: "https://proj.supabase.co", serviceRoleKey: "service" }) }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));

const { BLOCKED_MEDIA_TTL_MS, blockedMediaKeys, forgetBlockedMedia, imageRequestObjectKey } = await import("./blocked-media");

const OWNER = "8f6c2a52-3d1e-4b8a-9c3f-2b1d4e5f6a7b";

beforeEach(() => {
  vi.resetAllMocks();
  // Past the last page: an empty one.
  mocks.select.mockResolvedValue({ data: [], error: null });
  forgetBlockedMedia();
});
/** Calls that started a read (the first page of each). */
const reads = () => mocks.select.mock.calls.filter(([after]) => after === null).length;

// R69-dmca: the proxy's view of what a takedown removed.
describe("blocked media", () => {
  it("names the storage object an optimised-image request asks for, in any spelling", () => {
    const source = `https://proj.supabase.co/storage/v1/object/public/listing-images/${OWNER}/re%68osted.webp`;
    const url = new URL(`https://drvn.app/_next/image?url=${encodeURIComponent(source)}&w=640&q=75`);
    expect(imageRequestObjectKey(url)).toBe(`listing-images/${OWNER}/rehosted.webp`);
    expect(imageRequestObjectKey(new URL("https://drvn.app/_next/image?url=%2Fhero.png&w=640"))).toBeNull();
    expect(imageRequestObjectKey(new URL("https://drvn.app/_next/image"))).toBeNull();
  });

  it("R69-dmca: a slow read doesn't stretch the 15-second window", async () => {
    let resolveRead: (value: unknown) => void = () => {};
    mocks.select.mockReturnValueOnce(new Promise((resolve) => { resolveRead = resolve; }));
    const pending = blockedMediaKeys(1_000);
    await new Promise((r) => setTimeout(r, 25));
    resolveRead({ data: [], error: null });
    await pending;
    mocks.select.mockResolvedValueOnce({ data: [{ object_key: "listing-images/a/b.webp" }], error: null });
    expect((await blockedMediaKeys(1_000 + BLOCKED_MEDIA_TTL_MS))?.has("listing-images/a/b.webp")).toBe(true);
  });

  it("shares one read between requests, and sees a new takedown within 15 seconds", async () => {
    mocks.select.mockResolvedValueOnce({ data: [], error: null });
    const start = Date.now();
    expect((await blockedMediaKeys(start))?.size).toBe(0);
    mocks.select.mockResolvedValueOnce({ data: [{ object_key: "listing-images/a/b.webp" }], error: null });
    expect((await blockedMediaKeys(start + 10_000))?.size).toBe(0);
    expect(reads()).toBe(1);
    expect((await blockedMediaKeys(start + BLOCKED_MEDIA_TTL_MS + 1))?.has("listing-images/a/b.webp")).toBe(true);
    expect(reads()).toBe(2);
  });

  it("keeps the last good list when a read fails, and says unknown (null), never empty, with none (N718)", async () => {
    mocks.select.mockResolvedValueOnce({ data: [{ object_key: "avatars/a/b.webp" }], error: null });
    await blockedMediaKeys(0);
    mocks.select.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    const keys = await blockedMediaKeys(Date.now() + 120_000);
    expect(keys?.has("avatars/a/b.webp")).toBe(true);
    expect(mocks.reportError).toHaveBeenCalledWith("[copyright] blocked media list unavailable", expect.anything());

    forgetBlockedMedia();
    mocks.select.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    expect(await blockedMediaKeys()).toBeNull();
  });
});

describe("the whole blocklist, past PostgREST's 1,000 rows (N718)", () => {
  it("reads every page by key until an empty page, so the 1,001st takedown is still blocked", async () => {
    const all = Array.from({ length: 1005 }, (_, i) => ({ object_key: `listing-images/o/${String(i).padStart(5, "0")}.webp` }));
    // A project whose max rows is 400: short pages that are not the end.
    mocks.select.mockImplementation(async (after: string | null, size: number) => ({ data: all.filter((r) => after === null || r.object_key > after).slice(0, Math.min(size, 400)), error: null }));
    const keys = await blockedMediaKeys(9_000_000);
    expect(keys?.size).toBe(1005);
    expect(keys?.has("listing-images/o/01004.webp")).toBe(true);
  });
});

