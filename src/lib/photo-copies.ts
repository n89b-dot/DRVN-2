import { isUnsignedMemberPhoto } from "@/lib/photo-urls";

/**
 * A stored copy of something that was read with its photos signed (review of
 * #210, work review #146).
 *
 * When the signer has no answer (the photo store is slow, a new server's
 * first readiness check failed), a read hands its photos back in the
 * canonical spelling, which nobody can load, and the page shows the no-photo
 * plate. That is right for one render. Stored, it is every visitor's render
 * until the copy runs out.
 *
 * Two kinds of copy exist, and neither may keep such a render:
 *  - the shared copy of public data (./supabase/public-cache.ts) holds the
 *    database's own answer, canonical, and each reader signs it on the way
 *    out, so it never holds a signed or an unsigned-by-failure result at all;
 *  - a copy of a finished, signed result (`unstable_cache` around a loader)
 *    goes through `storedUnlessUnsigned`: a result that still holds an
 *    unsigned member photo is handed to this caller and not stored.
 * The generated share cards are not stored by the framework at all: each
 * waits for a request (`connection()`), which tests/ci/share-images.test.ts
 * holds.
 */

/** Whether anything in a value is a member photo still in its canonical spelling. */
export function holdsUnsignedMemberPhoto(value: unknown): boolean {
  return isUnsignedMemberPhoto(JSON.stringify(value) ?? "");
}

class NotStored<T> extends Error {
  constructor(readonly value: T) {
    super("Not stored: the result holds an unsigned member photo");
  }
}

/**
 * `store` is the cache: given a loader it returns a function that answers
 * from its copy, and stores what the loader resolves with. Next's
 * `unstable_cache` is one, and like it, `store` must keep nothing when the
 * loader throws.
 */
export function storedUnlessUnsigned<T>(load: () => Promise<T>, store: (load: () => Promise<T>) => () => Promise<T>): () => Promise<T> {
  const stored = store(async () => {
    const value = await load();
    if (holdsUnsignedMemberPhoto(value)) throw new NotStored(value);
    return value;
  });
  return async () => {
    try {
      return await stored();
    } catch (error) {
      if (error instanceof NotStored) return error.value as T;
      throw error;
    }
  };
}
