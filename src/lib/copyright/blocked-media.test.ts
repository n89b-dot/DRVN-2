import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), reportError: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: () => ({ select: () => ({ limit: mocks.select }) }) }),
}));
vi.mock("@/lib/env", () => ({ requireServerEnv: () => ({ url: "https://proj.supabase.co", serviceRoleKey: "service" }) }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));

const { BLOCKED_MEDIA_TTL_MS, blockedMediaKeys, forgetBlockedMedia, imageRequestObjectKey } = await import("./blocked-media");

const OWNER = "8f6c2a52-3d1e-4b8a-9c3f-2b1d4e5f6a7b";

beforeEach(() => {
  vi.clearAllMocks();
  forgetBlockedMedia();
});

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
    expect((await blockedMediaKeys(1_000 + BLOCKED_MEDIA_TTL_MS)).has("listing-images/a/b.webp")).toBe(true);
  });

  it("shares one read between requests, and sees a new takedown within 15 seconds", async () => {
    mocks.select.mockResolvedValueOnce({ data: [], error: null });
    const start = Date.now();
    expect((await blockedMediaKeys(start)).size).toBe(0);
    mocks.select.mockResolvedValueOnce({ data: [{ object_key: "listing-images/a/b.webp" }], error: null });
    expect((await blockedMediaKeys(start + 10_000)).size).toBe(0);
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect((await blockedMediaKeys(start + BLOCKED_MEDIA_TTL_MS + 1)).has("listing-images/a/b.webp")).toBe(true);
    expect(mocks.select).toHaveBeenCalledTimes(2);
  });

  it("serves images when the list can't be read, keeping the last good list", async () => {
    mocks.select.mockResolvedValueOnce({ data: [{ object_key: "avatars/a/b.webp" }], error: null });
    await blockedMediaKeys(0);
    mocks.select.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    const keys = await blockedMediaKeys(Date.now() + 120_000);
    expect(keys.has("avatars/a/b.webp")).toBe(true);
    expect(mocks.reportError).toHaveBeenCalledWith("[copyright] blocked media list unavailable", expect.anything());

    forgetBlockedMedia();
    mocks.select.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    expect((await blockedMediaKeys()).size).toBe(0);
  });
});
