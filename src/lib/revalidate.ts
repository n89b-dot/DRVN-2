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
 *
 * The path must be one the server chose. A path a browser sent (a form
 * field, an action argument) lets any member clear whatever they like —
 * `/` or `/admin` clears every kind of public data — so actions derive it
 * from the object they just changed (N58).
 */
export function revalidatePath(path: string, type?: "layout" | "page"): void {
  clearPublicData(...publicKindsForPath(path));
  if (type) nextRevalidatePath(path, type);
  else nextRevalidatePath(path);
}

/** The only page whose server copy shows a member's notifications. */
export const NOTIFICATIONS_PATH = "/notifications";

/**
 * A member's notifications changed (one read, or all of them).
 *
 * Narrow on purpose (N57). Notifications are private, so no public data is
 * cleared, and only their own list is marked stale. The bell badge needs
 * nothing more: it is counted afresh on every render of the shell
 * (`loadShellCounts`), and a server action that revalidates anything makes
 * the member's router refresh every segment, layouts included. It used to
 * revalidate `/` as a layout, which threw away the shared public copy and
 * every cached page for everyone each time one member opened one
 * notification.
 */
export function revalidateNotifications(): void {
  nextRevalidatePath(NOTIFICATIONS_PATH);
}
