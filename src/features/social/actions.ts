"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type SaveTargetType = "listing" | "car" | "profile";
export type FollowTargetType = "car" | "profile";

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
    await supabase
      .from("saves")
      .delete()
      .eq("user_id", user.id)
      .eq("target_type", targetType)
      .eq("target_id", targetId);
    revalidatePath(path);
    return { saved: false };
  }

  const { error } = await supabase
    .from("saves")
    .insert({ user_id: user.id, target_type: targetType, target_id: targetId });
  if (error) return { error: error.message };
  revalidatePath(path);
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
    await supabase
      .from("follows")
      .delete()
      .eq("follower_id", user.id)
      .eq("target_type", targetType)
      .eq("target_id", targetId);
    revalidatePath(path);
    return { following: false };
  }

  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: user.id, target_type: targetType, target_id: targetId });
  if (error) return { error: error.message };
  revalidatePath(path);
  return { following: true };
}
