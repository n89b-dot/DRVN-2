import "server-only";

import { revalidateTag } from "next/cache";

import { PUBLIC_TAGS, type PublicDataKind } from "./public-cache";

/**
 * Throws away the shared copy of public data of these kinds, so the next
 * signed-out visitor reads what was just written. Call it after a write to
 * anything a public page shows.
 *
 * `expire: 0` rather than the stale-while-revalidate profile: a part that
 * just sold must not be offered once more while a refresh runs.
 *
 * Never throws. Outside a request (a script, a unit test) there is no cache
 * to clear, and a failed clear must not fail the write it follows — the
 * copy's age limit covers it.
 */
export function clearPublicData(...kinds: PublicDataKind[]): void {
  for (const kind of new Set(kinds)) {
    try {
      revalidateTag(PUBLIC_TAGS[kind], { expire: 0 });
    } catch {
      // No request scope — nothing cached here to clear.
    }
  }
}
