import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import { publishChatPhotos, removeOwnerChatPhotos, signChatPhotos } from "./chat-photos";

const ME = "11111111-1111-4111-8111-111111111111";
const FILE = "33333333-3333-4333-8333-333333333333";
const ref = `https://proj.supabase.co/storage/v1/object/authenticated/agent-chat-photos/${ME}/${FILE}.webp`;

function fakeAdmin() {
  const removed: string[][] = [];
  const uploads: { bucket: string; path: string }[] = [];
  let listed = false;
  const admin = {
    from: () => ({ upsert: async () => ({ error: null }) }),
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
        download: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        upload: async (path: string) => {
          uploads.push({ bucket, path });
          return { error: null };
        },
      }),
    },
  };
  return { admin: admin as never, removed, uploads };
}

describe("R81 private chat photos", () => {
  it("clearing the chat removes every photo in the member's folder", async () => {
    const { admin, removed } = fakeAdmin();
    expect(await removeOwnerChatPhotos(admin, ME)).toBe(2);
    expect(removed).toEqual([[`${ME}/${FILE}.webp`, `${ME}/other.webp`]]);
  });

  it("shows a chat photo only through a signed link, and leaves an older public photo as it was", async () => {
    const { admin } = fakeAdmin();
    const legacy = `https://proj.supabase.co/storage/v1/object/public/listing-images/${ME}/old.jpg`;
    const signed = await signChatPhotos(admin, [ref, legacy]);
    expect(signed.get(ref)).toBe(`https://signed/${ME}/${FILE}.webp`);
    expect(signed.get(legacy)).toBe(legacy);
  });

  it("a photo job's draft gets its own public copy, named after the chat photo, and never someone else's", async () => {
    const { admin, uploads } = fakeAdmin();
    const urls = await publishChatPhotos(admin, ME, [ref, ref.replace(ME, "22222222-2222-4222-8222-222222222222")], "listing-images");
    expect(urls).toEqual([`https://proj.supabase.co/storage/v1/object/public/listing-images/${ME}/chat-${FILE}.webp`]);
    expect(uploads).toEqual([{ bucket: "listing-images", path: `${ME}/chat-${FILE}.webp` }]);
  });
});
