"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { capture } from "@/lib/analytics";
import { CATEGORIES } from "@/lib/marketplace/taxonomy";

/**
 * Saved searches (brief §C). Saving is silent; alerts are a separate,
 * explicit opt-in (`alert` defaults false, 0044). The params jsonb mirrors
 * the /marketplace query string, so a saved search IS a URL.
 */

export type SavedSearchState = { error?: string; ok?: string };

const PARAM_KEYS = ["q", "category", "subcategory", "condition", "min", "max", "location", "fit"] as const;

function readParams(formData: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of PARAM_KEYS) {
    const value = String(formData.get(`p_${key}`) ?? "").trim().slice(0, 200);
    if (value) params[key] = value;
  }
  return params;
}

/** A human name for the saved state: the query, else the category, else "Everything". */
function nameFor(params: Record<string, string>): string {
  if (params.q) return `“${params.q}”`;
  if (params.category) {
    const category = CATEGORIES.find((c) => c.slug === params.category);
    const sub = category?.subcategories.find((s) => s.slug === params.subcategory);
    return sub?.label ?? category?.label ?? params.category;
  }
  if (params.fit === "1") return "Parts that fit my garage";
  return "Everything on the marketplace";
}

export async function createSavedSearch(
  _prev: SavedSearchState,
  formData: FormData,
): Promise<SavedSearchState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to save searches." };

  const params = readParams(formData);
  if (Object.keys(params).length === 0) {
    return { error: "Set a search or a filter first — then save it." };
  }

  // Saving the same state twice quietly succeeds — never an error, never a
  // duplicate row.
  const { data: existing } = await supabase
    .from("saved_searches")
    .select("id, params")
    .eq("user_id", user.id)
    .limit(50);
  const key = JSON.stringify(Object.fromEntries(Object.entries(params).sort()));
  if (
    (existing ?? []).some(
      (row) => JSON.stringify(Object.fromEntries(Object.entries(row.params ?? {}).sort())) === key,
    )
  ) {
    return { ok: "Already saved — it's in Saved." };
  }

  const { error } = await supabase.from("saved_searches").insert({
    user_id: user.id,
    name: nameFor(params).slice(0, 120),
    params,
  });
  if (error) {
    return {
      error: error.message.includes("limit")
        ? "You've hit 50 saved searches — prune a few in Saved first."
        : "Couldn't save that search.",
    };
  }
  capture(user.id, { event: "saved_search_created" });
  revalidatePath("/saved");
  return { ok: "Saved — find it under Saved. Alerts stay off until you turn them on." };
}

export async function setSavedSearchAlert(formData: FormData): Promise<SavedSearchState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };
  const id = String(formData.get("id") ?? "");
  const alert = formData.get("alert") === "on";
  const { error } = await supabase
    .from("saved_searches")
    .update({ alert })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { error: "Couldn't update alerts." };
  if (alert) capture(user.id, { event: "saved_search_alert_enabled" });
  revalidatePath("/saved");
  return { ok: alert ? "Alerts on — you'll hear when new inventory matches." : "Alerts off." };
}

export async function deleteSavedSearch(formData: FormData): Promise<SavedSearchState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };
  const id = String(formData.get("id") ?? "");
  const { error } = await supabase
    .from("saved_searches")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { error: "Couldn't delete that." };
  revalidatePath("/saved");
  return { ok: "Deleted." };
}
