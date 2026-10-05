import "server-only";

import { revalidatePath as nextRevalidatePath } from "next/cache";

import { clearPublicData } from "@/lib/supabase/clear-public-data";
import { publicKindsForPath } from "@/lib/supabase/public-cache";

/**
 * `revalidatePath`, plus: clears the shared copy of public data the change
 * may have touched (src/lib/supabase/public-cache.ts).
 *
 * Every action imports this one instead of `next/cache`'s —
 * src/lib/revalidate.test.ts fails the build on a direct import — so a new
 * write clears the copy signed-out visitors read without anyone having to
 * remember to.
 */
export function revalidatePath(path: string, type?: "layout" | "page"): void {
  clearPublicData(...publicKindsForPath(path));
  if (type) nextRevalidatePath(path, type);
  else nextRevalidatePath(path);
}
