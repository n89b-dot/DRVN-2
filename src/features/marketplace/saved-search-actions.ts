"use server";

import { revalidatePath } from "@/lib/revalidate";

import { createClient } from "@/lib/supabase/server";
import { capture } from "@/lib/analytics";
import { SAVED_SEARCH_KEYS, savedSearchKey, writeSavedSearch } from "@/lib/marketplace/saved-search";
import { normalizeMarketplaceState } from "@/lib/marketplace/state";
import { savedSearchName } from "./saved-search-name";

/**
 * Saved searches (brief §C). Saving is silent; alerts are a separate,
 * explicit opt-in (`alert` defaults false, 0044). The params jsonb mirrors
 * the /marketplace query string, so a saved search IS a URL.
 */

export type SavedSearchState = { error?: string; ok?: string };

const PARAM_KEYS = SAVED_SEARCH_KEYS;

function readParams(formData: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of PARAM_KEYS) {
    const value = String(formData.get(`p_${key}`) ?? "").trim().slice(0, 200);
    if (value) params[key] = value;
  }
  return Object.fromEntries(Object.entries(normalizeMarketplaceState(params)).filter((entry): entry is [string, string] => Boolean(entry[1])));
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
  const key = savedSearchKey(params);
  if (
    (existing ?? []).some(
      (row) => savedSearchKey(row.params) === key,
    )
  ) {
    return { ok: "Already saved — it's in Saved." };
  }

  const { error } = await supabase.rpc("save_marketplace_search", {
    p_name: ((await savedSearchName(params)) ?? "Saved search").slice(0, 120), p_params: writeSavedSearch(params),
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
  const { data, error } = await supabase
    .from("saved_searches")
    .update({ alert })
    .eq("id", id)
    .eq("user_id", user.id).select("id").maybeSingle();
  if (error || !data) return { error: "Couldn't update alerts. Reload Saved and try again." };
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
  const { data, error } = await supabase
    .from("saved_searches")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id).select("id").maybeSingle();
  if (error || !data) return { error: "Couldn't delete that. Reload Saved and try again." };
  revalidatePath("/saved");
  return { ok: "Deleted." };
}
