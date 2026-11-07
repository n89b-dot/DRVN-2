import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), reportError: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: () => ({ select: () => ({ limit: mocks.select }) }) }),
}));
vi.mock("@/lib/env", () => ({ requireServerEnv: () => ({ url: "https://proj.supabase.co", serviceRoleKey: "service" }) }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));

const { blockedMediaKeys, forgetBlockedMedia, imageRequestObjectKey } = await import("./blocked-media");

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

  it("reads the list once a minute, not once a request", async () => {
    mocks.select.mockResolvedValue({ data: [{ object_key: "listing-images/a/b.webp" }], error: null });
    const first = await blockedMediaKeys(1_000);
    await blockedMediaKeys(30_000);
    expect(first.has("listing-images/a/b.webp")).toBe(true);
    expect(mocks.select).toHaveBeenCalledTimes(1);
    await blockedMediaKeys(Date.now() + 61_000);
    expect(mocks.select).toHaveBeenCalledTimes(2);
  });

  it("a takedown on this instance applies at once", async () => {
    mocks.select.mockResolvedValueOnce({ data: [], error: null });
    expect((await blockedMediaKeys()).size).toBe(0);
    mocks.select.mockResolvedValueOnce({ data: [{ object_key: "avatars/a/b.webp" }], error: null });
    forgetBlockedMedia();
    expect((await blockedMediaKeys()).has("avatars/a/b.webp")).toBe(true);
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
