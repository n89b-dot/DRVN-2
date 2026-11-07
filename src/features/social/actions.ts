"use server";

import { revalidatePath } from "@/lib/revalidate";

import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";
import { allowAction, RATE_LIMITS, rateLimitMessage } from "@/lib/rate-limit";

export type SaveTargetType = "listing" | "car" | "profile" | "post";
export type LikeTargetType = "listing" | "car";
export type FollowTargetType = "car" | "profile";

/**
 * `path` arrives from the client, and `revalidatePath` on an arbitrary string
 * lets any signed-in user thrash the cache for any route. Only the shapes these
 * buttons legitimately appear on are honoured; anything else is ignored.
 */
const ALLOWED_PATHS = [
  /^\/listings\/[\w-]+$/,
  /^\/cars\/[\w-]+$/,
  /^\/cars\/[\w-]+\/activity\/[\w-]+$/,
  /^\/u\/[\w.-]+$/,
  /^\/(home|explore|marketplace|saved|profile)$/,
  /^\/marketplace\/[\w-]+(\/[\w-]+)?$/,
];

function revalidateIfAllowed(path: string) {
  path = path.split("?")[0];
  if (ALLOWED_PATHS.some((pattern) => pattern.test(path))) {
    revalidatePath(path);
    return;
  }
  console.warn("[social] ignoring revalidate for unexpected path", { path });
}

async function setRelationship(
  kind: "save" | "like" | "follow",
  targetType: SaveTargetType | LikeTargetType | FollowTargetType,
  targetId: string,
  active: boolean,
): Promise<{ active: boolean } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "login" } as const;

  // Likes and follows notify the member on the other end, so turning them on
  // is throttled like any other notification source. Turning one off, and
  // saves (private to the saver), are never limited.
  const rule = !active ? null : kind === "follow" ? RATE_LIMITS.follow : kind === "like" ? RATE_LIMITS.react : null;
  if (rule && !(await allowAction(rule, user.id))) return { error: rateLimitMessage(rule) } as const;

  const result = await supabase.rpc("set_social_relationship", {
    p_kind: kind,
    p_target_type: targetType,
    p_target_id: targetId,
    p_active: active,
  });
  // The thing was deleted (a tab left open on it): trying again can't help.
  if (result.error?.code === "23503") return { error: "That's no longer on DRVN." } as const;
  if (result.error || result.data !== active) {
    reportError("[social] relationship update failed", { kind, targetType, error: result.error });
    return { error: "Couldn't update that. Try again." } as const;
  }
  return { active } as const;
}

export async function toggleSave(
  targetType: SaveTargetType,
  targetId: string,
  path: string,
  saved: boolean,
): Promise<{ saved: boolean } | { error: string }> {
  const result = await setRelationship("save", targetType, targetId, saved);
  if ("error" in result) return result;
  revalidateIfAllowed(path);
  return { saved: result.active };
}

/** Public like on a listing or car (0037). Posts like through
 *  activity/actions' toggleReaction instead — same gesture, existing row. */
export async function toggleLike(
  targetType: LikeTargetType,
  targetId: string,
  path: string,
  liked: boolean,
): Promise<{ liked: boolean } | { error: string }> {
  const result = await setRelationship("like", targetType, targetId, liked);
  if ("error" in result) return result;
  revalidateIfAllowed(path);
  return { liked: result.active };
}

export async function toggleFollow(
  targetType: FollowTargetType,
  targetId: string,
  path: string,
  following: boolean,
): Promise<{ following: boolean } | { error: string }> {
  const result = await setRelationship("follow", targetType, targetId, following);
  if ("error" in result) return result;
  revalidateIfAllowed(path);
  return { following: result.active };
}

export type SocialRemovalState = { error?: string };

/** Direct removal from the Saved page, which had no way to unsave anything. */
export async function removeSave(_previous: SocialRemovalState, formData: FormData): Promise<SocialRemovalState> {
  const targetType = String(formData.get("target_type") ?? "") as SaveTargetType;
  const targetId = String(formData.get("target_id") ?? "");
  if (!targetId || !["listing", "car", "profile", "post"].includes(targetType)) return { error: "That saved item couldn't be removed." };

  const result = await setRelationship("save", targetType, targetId, false);
  if ("error" in result) return { error: result.error === "login" ? "Sign in again to remove this." : result.error };

  revalidatePath("/saved");
  return {};
}

export async function removeFollow(_previous: SocialRemovalState, formData: FormData): Promise<SocialRemovalState> {
  const targetType = String(formData.get("target_type") ?? "") as FollowTargetType;
  const targetId = String(formData.get("target_id") ?? "");
  if (!targetId || !["car", "profile"].includes(targetType)) return { error: "That follow couldn't be removed." };

  const result = await setRelationship("follow", targetType, targetId, false);
  if ("error" in result) return { error: result.error === "login" ? "Sign in again to remove this." : result.error };

  revalidatePath("/saved");
  return {};
}
