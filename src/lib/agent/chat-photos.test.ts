import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import { publishChatPhotos, removeOwnerChatPhotos, signChatPhotos } from "./chat-photos";

const ME = "11111111-1111-4111-8111-111111111111";
const FILE = "33333333-3333-4333-8333-333333333333";
const ORIGIN = "https://proj.supabase.co";
const ref = `${ORIGIN}/storage/v1/object/authenticated/agent-chat-photos/${ME}/${FILE}.webp`;
const publicUrl = (bucket: string, path: string) => `${ORIGIN}/storage/v1/object/public/${bucket}/${path}`;

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ORIGIN));
afterEach(() => vi.unstubAllEnvs());

/**
 * Storage and the staged_uploads ledger as they behave: objects live per
 * bucket, but a ledger row's `path` is unique across every bucket (0029), so
 * an upsert that ignores duplicates silently keeps the first row for a path.
 */
function fakeAdmin() {
  const removed: string[][] = [];
  const uploads: { bucket: string; path: string }[] = [];
  const downloads: string[] = [];
  const ledger: { bucket: string; path: string }[] = [];
  const objects = new Map<string, Set<string>>([["agent-chat-photos", new Set([`${ME}/${FILE}.webp`])]]);
  const inBucket = (bucket: string) => objects.get(bucket) ?? objects.set(bucket, new Set()).get(bucket)!;
  let listed = false;
  const admin = {
    from: () => ({
      upsert: async (row: { bucket: string; path: string }) => {
        if (!ledger.some((entry) => entry.path === row.path)) ledger.push({ bucket: row.bucket, path: row.path });
        return { error: null };
      },
      select: () => {
        const filters: [string, string][] = [];
        const query = {
          eq: (column: string, value: string) => (filters.push([column, value]), query),
          maybeSingle: async () => ({ data: ledger.find((entry) => filters.every(([column, value]) => entry[column as "bucket" | "path"] === value)) ?? null, error: null }),
        };
        return query;
      },
    }),
    storage: {
      from: (bucket: string) => ({
        list: async () => {
          if (listed) return { data: [], error: null };
          listed = true;
          return { data: [{ id: "a", name: `${FILE}.webp` }, { id: "b", name: "other.webp" }], error: null };
        },
        remove: async (names: string[]) => {
          removed.push(names);
          return { error: null };
        },
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })), error: null }),
        exists: async (path: string) => (inBucket(bucket).has(path) ? { data: true, error: null } : { data: false, error: { status: 404 } }),
        download: async (path: string) => {
          downloads.push(`${bucket}/${path}`);
          return inBucket(bucket).has(path) ? { data: new Blob([new Uint8Array([1, 2, 3])]), error: null } : { data: null, error: { message: "Object not found" } };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: publicUrl(bucket, path) } }),
        upload: async (path: string) => {
          if (inBucket(bucket).has(path)) return { error: { statusCode: "409", message: "The resource already exists" } };
          inBucket(bucket).add(path);
          uploads.push({ bucket, path });
          return { error: null };
        },
      }),
    },
  };
  /** The chat photo goes, as the 48-hour sweep or a clear removes it. */
  const expireOriginal = () => objects.get("agent-chat-photos")!.clear();
  return { admin: admin as never, removed, uploads, downloads, ledger, expireOriginal };
}

describe("R81 private chat photos", () => {
  it("clearing the chat removes every photo in the member's folder", async () => {
    const { admin, removed } = fakeAdmin();
    expect(await removeOwnerChatPhotos(admin, ME)).toBe(2);
    expect(removed).toEqual([[`${ME}/${FILE}.webp`, `${ME}/other.webp`]]);
  });

  it("shows a chat photo only through a signed link, and leaves an older public photo as it was", async () => {
    const { admin } = fakeAdmin();
    const legacy = `${ORIGIN}/storage/v1/object/public/listing-images/${ME}/old.jpg`;
    const signed = await signChatPhotos(admin, [ref, legacy]);
    expect(signed.get(ref)).toBe(`https://signed/${ME}/${FILE}.webp`);
    expect(signed.get(legacy)).toBe(legacy);
  });

  it("a photo job's draft gets its own public copy, named after the chat photo, and never someone else's", async () => {
    const { admin, uploads } = fakeAdmin();
    const urls = await publishChatPhotos(admin, ME, [ref, ref.replace(ME, "22222222-2222-4222-8222-222222222222")], "listing-images");
    expect(urls).toEqual([publicUrl("listing-images", `${ME}/chat-${FILE}.webp`)]);
    expect(uploads).toEqual([{ bucket: "listing-images", path: `${ME}/chat-${FILE}.webp` }]);
  });

  it("one photo used for a listing and an update: every public copy has its own ledger row, so an abandoned draft's copy is swept", async () => {
    const { admin, uploads, ledger } = fakeAdmin();
    const listing = await publishChatPhotos(admin, ME, [ref], "listing-images");
    const update = await publishChatPhotos(admin, ME, [ref], "activity-images");
    expect(listing).toHaveLength(1);
    expect(update).toHaveLength(1);
    expect(uploads).toHaveLength(2);
    // Two objects, two different ledger paths: neither upsert was swallowed.
    for (const copy of uploads) expect(ledger).toContainEqual(copy);
  });

  it("never makes a public copy the ledger doesn't track", async () => {
    const { admin, uploads, ledger } = fakeAdmin();
    // A row for the destination's path already exists, in another bucket.
    ledger.push({ bucket: "car-images", path: `${ME}/chat-${FILE}.webp` });
    expect(await publishChatPhotos(admin, ME, [ref], "listing-images")).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it("reopening a draft after the chat photo expired keeps the public copy it already has", async () => {
    const { admin, uploads, downloads, expireOriginal } = fakeAdmin();
    const first = await publishChatPhotos(admin, ME, [ref], "listing-images");
    expect(first).toHaveLength(1);
    expireOriginal();
    downloads.length = 0;
    // 48 hours on, the private original is gone; the listing's copy is not.
    expect(await publishChatPhotos(admin, ME, [ref], "listing-images")).toEqual(first);
    expect(uploads).toHaveLength(1);
    // The existing copy is reused before the original is even fetched.
    expect(downloads).toEqual([]);
  });

  it("a draft from before private chat photos keeps its member's own public photos, and only those", async () => {
    const { admin, uploads } = fakeAdmin();
    const legacy = publicUrl("listing-images", `${ME}/44444444-4444-4444-8444-444444444444.webp`);
    const urls = await publishChatPhotos(
      admin,
      ME,
      [
        legacy,
        publicUrl("listing-images", `22222222-2222-4222-8222-222222222222/theirs.webp`),
        publicUrl("message-photos", `${ME}/private.webp`),
        `https://elsewhere.example/storage/v1/object/public/listing-images/${ME}/x.webp`,
        `${legacy}?download=1`,
      ],
      "listing-images",
    );
    expect(urls).toEqual([legacy]);
    expect(uploads).toEqual([]);
  });
});
