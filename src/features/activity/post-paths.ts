import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { revalidatePath } from "@/lib/revalidate";

/**
 * The pages a post's reactions and replies show on, worked out from the post
 * itself (N58).
 *
 * Reaction and reply actions used to revalidate whatever path the browser
 * sent, so any signed-in member could ask the server to clear `/` — every
 * kind of shared public data — as often as the rate limit let them react.
 * Now the browser names only the post; the server reads it under the
 * member's own RLS and refreshes its canonical page (a car's post lives under
 * the car, W-5) and the car's own page. The member's current page refreshes
 * regardless: any revalidation from a server action refreshes their router.
 */
export function postPagePaths(post: { id: string; carSlug: string | null }): string[] {
  return post.carSlug
    ? [`/cars/${post.carSlug}/activity/${post.id}`, `/cars/${post.carSlug}`]
    : [`/posts/${post.id}`];
}

/** Revalidates the pages of the post `postId`, if the member can read it. */
export async function revalidatePostPages(supabase: SupabaseClient<Database>, postId: string): Promise<void> {
  const { data: post } = await supabase
    .from("activity_posts")
    .select("id, cars(slug)")
    .eq("id", postId)
    .maybeSingle();
  // Nothing the member can read: there is no page of theirs to refresh.
  if (!post) return;
  const car = post.cars as unknown as { slug: string | null } | null;
  for (const path of postPagePaths({ id: post.id, carSlug: car?.slug ?? null })) revalidatePath(path);
}
