import { describe, expect, it } from "vitest";

import { holdsUnsignedMemberPhoto, storedUnlessUnsigned } from "./photo-copies";

const O = "https://proj.supabase.co/storage/v1/object";
const unsigned = `${O}/public/car-images/11111111-1111-4111-8111-111111111111/cover.webp`;
const signed = `${O}/sign/car-images/11111111-1111-4111-8111-111111111111/cover.webp?token=abc`;

/** A cache with `unstable_cache`'s contract: it stores what the loader resolves with and nothing when it throws. */
function fakeStore<T>() {
  const state: { copy?: { value: T }; loads: number } = { loads: 0 };
  const store = (load: () => Promise<T>) => async () => {
    if (state.copy) return state.copy.value;
    state.loads += 1;
    const value = await load();
    state.copy = { value };
    return value;
  };
  return { state, store };
}

describe("N1062: a result read while the signer had no answer is shown once and not stored (review of #210)", () => {
  it("N1062: finds an unsigned member photo anywhere in a value, and no other address", () => {
    expect(holdsUnsignedMemberPhoto([{ kind: "build", build: { cover_image_url: unsigned } }])).toBe(true);
    expect(holdsUnsignedMemberPhoto({ cards: [{ listing: { images: [{ url: signed }] } }] })).toBe(false);
    expect(holdsUnsignedMemberPhoto([{ avatar_url: `${O}/public/avatars/me.webp`, cover: "/seed/cars/1.webp" }])).toBe(false);
    expect(holdsUnsignedMemberPhoto([])).toBe(false);
    expect(holdsUnsignedMemberPhoto(undefined)).toBe(false);
  });

  it("N1062: a signed result is stored and answered from the copy", async () => {
    const { state, store } = fakeStore<{ cover: string }[]>();
    const get = storedUnlessUnsigned(async () => [{ cover: signed }], store);
    expect(await get()).toEqual([{ cover: signed }]);
    expect(await get()).toEqual([{ cover: signed }]);
    expect(state.loads).toBe(1);
  });

  it("N1062: an unsigned result reaches its caller, is not stored, and the next call reads again", async () => {
    const { state, store } = fakeStore<{ cover: string }[]>();
    const answers = [[{ cover: unsigned }], [{ cover: signed }]];
    const get = storedUnlessUnsigned(async () => answers.shift()!, store);
    // The signer had no answer: this visitor sees the plate, and nothing is kept.
    expect(await get()).toEqual([{ cover: unsigned }]);
    expect(state.copy).toBeUndefined();
    // It answers again: the next visitor gets the photo, and that is what is stored.
    expect(await get()).toEqual([{ cover: signed }]);
    expect(state.copy).toEqual({ value: [{ cover: signed }] });
    expect(state.loads).toBe(2);
  });

  it("N1062: a loader's own failure is still a failure", async () => {
    const { store } = fakeStore<string[]>();
    const get = storedUnlessUnsigned<string[]>(async () => { throw new Error("database down"); }, store);
    await expect(get()).rejects.toThrow("database down");
  });
});
