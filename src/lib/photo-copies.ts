import { isUnsignedMemberPhoto } from "@/lib/photo-urls";

/**
 * A copy of something that was read with its photos signed (reviews of #210
 * and #244).
 *
 * When the signer has no answer (the photo store is slow, a new server's
 * first readiness check failed), a read hands its photos back in the
 * canonical spelling, which nobody can load, and the page shows the no-photo
 * plate. That is right for one render. Kept, it is every visitor's render
 * until the copy runs out. And a signed link runs out by itself: a copy that
 * outlives its links shows dead photos.
 *
 * Where such copies are, and why none can be wrong for long:
 *  - the shared copy of public data (./supabase/public-cache.ts) holds the
 *    database's own answer, canonical, and each reader signs it on the way
 *    out, so it never holds a signed link or a failed signing at all;
 *  - the generated share cards are not stored by the framework: each waits
 *    for a request (`connection()`), which tests/ci/share-images.test.ts holds;
 *  - a finished, signed result kept for a short while (the sign-in pages'
 *    backdrop) uses `timedCopy` below.
 *
 * Not Next's `unstable_cache` for that last kind. Once it holds an entry, a
 * stale one is handed out at once and refreshed behind the response, and a
 * refresh that throws is logged and the old entry kept, at any age: there is
 * no way to say "do not keep this result" that also stops the old one being
 * served, and a copy whose refresh keeps failing outlives its links.
 */

/** Whether any of these addresses is a member photo still in its canonical spelling. Pass the photo fields, not the whole value: a member can write such an address into a title. */
export function anyUnsignedMemberPhoto(photos: readonly (string | null | undefined)[]): boolean {
  return photos.some((photo) => isUnsignedMemberPhoto(photo));
}

/**
 * `load`'s result, kept in this process for `maxAgeMs` and never handed out
 * older than that. A result is kept only when `keep` says so; one that is not
 * kept still reaches the caller that asked. Callers that arrive while a load
 * is running share it. A load that throws keeps nothing, and its error
 * reaches every caller waiting on it.
 */
export function timedCopy<T>(
  load: () => Promise<T>,
  { maxAgeMs, keep, now = Date.now }: { maxAgeMs: number; keep: (value: T) => boolean; now?: () => number },
): () => Promise<T> {
  let copy: { value: T; loadedAt: number } | null = null;
  let loading: Promise<T> | null = null;
  return () => {
    if (copy && now() - copy.loadedAt < maxAgeMs) return Promise.resolve(copy.value);
    loading ??= (async () => {
      // Aged from when the read began: what it holds is at least that old.
      const loadedAt = now();
      try {
        const value = await load();
        copy = keep(value) ? { value, loadedAt } : null;
        return value;
      } catch (error) {
        copy = null;
        throw error;
      } finally {
        loading = null;
      }
    })();
    return loading;
  };
}
