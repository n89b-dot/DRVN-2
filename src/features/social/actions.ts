"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type SaveTargetType = "listing" | "car" | "profile";
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
  if (ALLOWED_PATHS.some((pattern) => pattern.test(path))) {
    revalidatePath(path);
    return;
  }
  console.warn("[social] ignoring revalidate for unexpected path", { path });
}

export async function toggleSave(
  targetType: SaveTargetType,
  targetId: string,
  path: string
): Promise<{ saved: boolean } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "login" };

  const { data: existing } = await supabase
    .from("saves")
    .select("target_id")
    .eq("user_id", user.id)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .maybeSingle();

  if (existing) {
    // The delete result used to be discarded, so a failure looked like success.
    const { error } = await supabase
      .from("saves")
      .delete()
      .eq("user_id", user.id)
      .eq("target_type", targetType)
      .eq("target_id", targetId);
    if (error) return { error: error.message };
    revalidateIfAllowed(path);
    return { saved: false };
  }

  const { error } = await supabase
    .from("saves")
    .insert({ user_id: user.id, target_type: targetType, target_id: targetId });
  if (error) return { error: error.message };
  revalidateIfAllowed(path);
  return { saved: true };
}

export async function toggleFollow(
  targetType: FollowTargetType,
  targetId: string,
  path: string
): Promise<{ following: boolean } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "login" };

  const { data: existing } = await supabase
    .from("follows")
    .select("target_id")
    .eq("follower_id", user.id)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("follower_id", user.id)
      .eq("target_type", targetType)
      .eq("target_id", targetId);
    if (error) return { error: error.message };
    revalidateIfAllowed(path);
    return { following: false };
  }

  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: user.id, target_type: targetType, target_id: targetId });
  if (error) return { error: error.message };
  revalidateIfAllowed(path);
  return { following: true };
}

/** Direct removal from the Saved page, which had no way to unsave anything. */
export async function removeSave(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const targetType = String(formData.get("target_type") ?? "") as SaveTargetType;
  const targetId = String(formData.get("target_id") ?? "");
  if (!targetId || !["listing", "car", "profile"].includes(targetType)) return;

  const { error } = await supabase
    .from("saves")
    .delete()
    .eq("user_id", user.id)
    .eq("target_type", targetType)
    .eq("target_id", targetId);
  if (error) console.error("[social] removeSave failed", error);

  revalidatePath("/saved");
}

export async function removeFollow(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const targetType = String(formData.get("target_type") ?? "") as FollowTargetType;
  const targetId = String(formData.get("target_id") ?? "");
  if (!targetId || !["car", "profile"].includes(targetType)) return;

  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", user.id)
    .eq("target_type", targetType)
    .eq("target_id", targetId);
  if (error) console.error("[social] removeFollow failed", error);

  revalidatePath("/saved");
}
