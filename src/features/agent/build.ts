"use server";

import { redirect } from "next/navigation";

import { saveModItems, type ModItemInput } from "@/app/(product)/garage/actions";
import { capture } from "@/lib/analytics";
import type { TurnCard } from "@/lib/ai/run";
import { createClient } from "@/lib/supabase/server";

import { buildChangeItems, buildListItems, type BuildDraft, type BuildList } from "./build-change";

export type BuildChangeState = { error?: string; ok?: string; sellHref?: string | null };

/**
 * Confirm on an "Update my build" card (A3c, AG-9) or a "Paste your build"
 * card (A3d). The draft comes from the
 * member's own stored chat (read as them, so only their cards), and is saved
 * through the mods editor's own saveModItems as the member: the new line
 * under the draft's id, and the part it replaces marked removed, never
 * deleted. Saving again converges on the same line, so a double tap or a
 * lost response does nothing twice.
 */
export async function confirmBuildChange(cardId: string): Promise<BuildChangeState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/agent");
  if (!/^[0-9a-f-]{36}$/i.test(cardId)) return { error: "That change isn't available any more." };

  const { data: messages } = await supabase
    .from("agent_messages")
    .select("cards")
    .eq("owner_id", user.id)
    .eq("role", "agent")
    .contains("cards", JSON.stringify([{ id: cardId }]))
    .limit(1);
  const draft = ((messages?.[0]?.cards ?? []) as TurnCard[]).find(
    (card): card is BuildDraft | BuildList => (card.kind === "build_change" || card.kind === "build_list") && card.id === cardId,
  );
  if (!draft) return { error: "That change isn't available any more." };

  const { data: car } = await supabase.from("cars").select("id").eq("id", draft.car).eq("owner_id", user.id).maybeSingle();
  if (!car) return { error: "That car isn't in your garage any more." };
  // N65: read the revision before the sheet, so the save can only be refused
  // as stale, never land over a newer edit this plan didn't see.
  const { data: revision } = await supabase.rpc("mod_sheet_revision", { p_car: car.id });
  if (!revision) return { error: "Couldn't read your build. Try again." };
  const { data: mods, error } = await supabase
    .from("mod_items")
    .select("id, group_label, brand, product, part_number, category, confidence, raw_text, position, status, product_url, image_url, source_domain, ref_price_cents, ref_price_currency, origin")
    .eq("car_id", car.id)
    .order("position");
  if (error) return { error: "Couldn't read your build. Try again." };

  const plan = draft.kind === "build_list" ? buildListItems(mods ?? [], draft) : buildChangeItems(mods ?? [], draft);
  if (plan.kind === "stale") return { error: "That part isn't on the car any more. Open the editor to make the change." };
  if (plan.kind === "saved") return { ok: "Already on your build.", sellHref: plan.sellHref };

  const result = await saveModItems(car.id, plan.items as ModItemInput[], revision);
  if (result.stale) return { error: "Your build changed since this was drafted. Open the editor to make the change." };
  if (result.error) return { error: result.error };
  if (draft.kind === "build_list") {
    capture(user.id, { event: "agent_build_list_confirmed", props: { lines: Math.min(draft.lines.length, 40) } });
    return { ok: "Saved to your build.", sellHref: null };
  }
  capture(user.id, { event: "agent_build_change_confirmed", props: { replaced: Boolean(draft.replaces) } });
  return { ok: "Saved to your build.", sellHref: plan.sellHref };
}
