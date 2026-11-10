import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), reportError: vi.fn(), tables: [] as string[] }));

vi.mock("@supabase/supabase-js", () => ({
  // One object is looked up by the table's key (N718): select → eq(object_key) → maybeSingle.
  createClient: () => ({
    from: (table: string) => {
      mocks.tables.push(table);
      return { select: () => ({ eq: (column: string, key: string) => ({ maybeSingle: () => mocks.lookup(column, key) }) }) };
    },
  }),
}));
vi.mock("@/lib/env", () => ({ requireServerEnv: () => ({ url: "https://proj.supabase.co", serviceRoleKey: "service" }) }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));

const { BLOCKED_MEDIA_REMEMBERED, BLOCKED_MEDIA_TTL_MS, forgetBlockedMedia, imageRequestObjectKey, mediaIsBlocked } = await import("./blocked-media");

const OWNER = "8f6c2a52-3d1e-4b8a-9c3f-2b1d4e5f6a7b";
const KEY = "listing-images/a/b.webp";
const found = (key: string) => ({ data: { object_key: key }, error: null });
const none = { data: null, error: null };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tables.length = 0;
  mocks.lookup.mockResolvedValue(none);
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

  it("R69-dmca: a slow lookup doesn't stretch the 15-second window", async () => {
    let answer: (value: unknown) => void = () => {};
    mocks.lookup.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const pending = mediaIsBlocked(KEY, 1_000);
    await new Promise((r) => setTimeout(r, 25));
    answer(none);
    expect(await pending).toBe(false);
    mocks.lookup.mockResolvedValueOnce(found(KEY));
    expect(await mediaIsBlocked(KEY, 1_000 + BLOCKED_MEDIA_TTL_MS)).toBe(true);
  });

  it("R69-dmca: requests for one photo share one lookup, and a new takedown is seen within 15 seconds", async () => {
    const start = Date.now();
    expect(await Promise.all([mediaIsBlocked(KEY, start), mediaIsBlocked(KEY, start), mediaIsBlocked(KEY, start)])).toEqual([false, false, false]);
    mocks.lookup.mockResolvedValue(found(KEY));
    expect(await mediaIsBlocked(KEY, start + 10_000)).toBe(false);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(await mediaIsBlocked(KEY, start + BLOCKED_MEDIA_TTL_MS + 1)).toBe(true);
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });

  it("N718: keeps the last answer for a photo when a lookup fails, and says unknown (null), never 'not blocked', with none", async () => {
    mocks.lookup.mockResolvedValueOnce(found("avatars/a/b.webp"));
    expect(await mediaIsBlocked("avatars/a/b.webp", 0)).toBe(true);
    mocks.lookup.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await mediaIsBlocked("avatars/a/b.webp", 120_000)).toBe(true);
    expect(mocks.reportError).toHaveBeenCalledWith("[copyright] blocked media lookup unavailable", expect.anything());
    // Asked again on the next request, not held as fresh.
    await mediaIsBlocked("avatars/a/b.webp", 120_001);
    expect(mocks.lookup).toHaveBeenCalledTimes(3);

    // A photo this instance has never checked, and a lookup that throws.
    expect(await mediaIsBlocked("avatars/never/asked.webp", 120_000)).toBeNull();
    mocks.lookup.mockRejectedValue(new Error("timed out"));
    expect(await mediaIsBlocked("avatars/never/asked-2.webp", 120_000)).toBeNull();
  });
});

describe("N718: the blocklist is asked about one object, however long it is (work review #155)", () => {
  it("N718: asks the database for the one object by the table's key, never for the list", async () => {
    mocks.lookup.mockImplementation(async (_column: string, key: string) => (key === "listing-images/o/01004.webp" ? found(key) : none));
    expect(await mediaIsBlocked("listing-images/o/01004.webp")).toBe(true);
    expect(await mediaIsBlocked("listing-images/o/00001.webp")).toBe(false);
    expect(mocks.tables).toEqual(["copyright_blocked_media", "copyright_blocked_media"]);
    expect(mocks.lookup.mock.calls).toEqual([["object_key", "listing-images/o/01004.webp"], ["object_key", "listing-images/o/00001.webp"]]);
  });

  it("N718: remembers a bounded number of answers, dropping the oldest", async () => {
    for (let i = 0; i <= BLOCKED_MEDIA_REMEMBERED; i++) await mediaIsBlocked(`car-images/o/${i}.webp`, 5_000);
    mocks.lookup.mockClear();
    // The newest is remembered; the oldest was dropped and is asked again.
    await mediaIsBlocked(`car-images/o/${BLOCKED_MEDIA_REMEMBERED}.webp`, 5_001);
    expect(mocks.lookup).not.toHaveBeenCalled();
    await mediaIsBlocked("car-images/o/0.webp", 5_001);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });
});
