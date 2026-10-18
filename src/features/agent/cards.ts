import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import type { TurnCard } from "@/lib/ai/run";

/** A result card ready to draw: what the agent pointed at, read as the member. */
export type ResolvedCard = { kind: "listing"; id: string; title: string; priceCents: number; image: string | null; href: string };

/**
 * Turns stored card ids (agent_messages.cards) into what the thread shows,
 * through the member's own client, so a card never shows something the
 * member couldn't open themselves. Gone or hidden listings drop out.
 */
export async function resolveCards(supabase: SupabaseClient<Database>, cards: TurnCard[]): Promise<Map<string, ResolvedCard>> {
  const ids = [...new Set(cards.filter((card) => card.kind === "listing").map((card) => card.id))];
  const resolved = new Map<string, ResolvedCard>();
  if (!ids.length) return resolved;
  const [{ data: listings }, { data: images }] = await Promise.all([
    supabase.from("listings").select("id, title, price_cents").in("id", ids),
    supabase.from("listing_images").select("listing_id, url, position").in("listing_id", ids).order("position"),
  ]);
  const cover = new Map<string, string>();
  for (const image of images ?? []) if (!cover.has(image.listing_id)) cover.set(image.listing_id, image.url);
  for (const listing of listings ?? []) {
    resolved.set(listing.id, {
      kind: "listing",
      id: listing.id,
      title: listing.title,
      priceCents: listing.price_cents,
      image: cover.get(listing.id) ?? null,
      href: `/listings/${listing.id}`,
    });
  }
  return resolved;
}
