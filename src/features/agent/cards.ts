import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import type { TurnCard } from "@/lib/ai/run";

/** A result card ready to draw: what the agent pointed at, read as the member. */
export type ResolvedCard =
  | { kind: "listing"; id: string; title: string; priceCents: number; image: string | null; href: string }
  | {
      kind: "build_change";
      id: string;
      carName: string;
      /** "KW V3 coilovers" — what goes on. */
      part: string;
      /** What it replaces, still named as it was. */
      replaces: string | null;
      image: string | null;
      /** Saved: a mod line with the draft's id is on the car. */
      applied: boolean;
      /** The car's build page once saved; the mods editor with the line filled in before. */
      href: string;
      editHref: string;
      /** "List the old one", once saved and only when something came off. */
      sellHref: string | null;
    };

type BuildCard = Extract<TurnCard, { kind: "build_change" }>;

/**
 * Turns stored card ids (agent_messages.cards) into what the thread shows,
 * through the member's own client, so a card never shows something the
 * member couldn't open themselves. Gone or hidden listings drop out.
 */
export async function resolveCards(supabase: SupabaseClient<Database>, cards: TurnCard[]): Promise<Map<string, ResolvedCard>> {
  const resolved = new Map<string, ResolvedCard>();
  const [, builds] = await Promise.all([resolveListings(supabase, cards, resolved), resolveBuildChanges(supabase, cards)]);
  for (const card of builds) resolved.set(card.id, card);
  return resolved;
}

async function resolveListings(supabase: SupabaseClient<Database>, cards: TurnCard[], resolved: Map<string, ResolvedCard>) {
  const ids = [...new Set(cards.filter((card) => card.kind === "listing").map((card) => card.id))];
  if (!ids.length) return;
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
}

/**
 * A drafted build change, on one of the member's own cars: drops out if the
 * car is gone. Saved when a mod line with the draft's id exists, since
 * Confirm saves the line under that id.
 */
async function resolveBuildChanges(supabase: SupabaseClient<Database>, cards: TurnCard[]): Promise<ResolvedCard[]> {
  const drafts = cards.filter((card): card is BuildCard => card.kind === "build_change");
  if (!drafts.length) return [];
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const carIds = [...new Set(drafts.map((draft) => draft.car))];
  const modIds = [...new Set(drafts.flatMap((draft) => [draft.id, ...(draft.replaces ? [draft.replaces] : [])]))];
  const [{ data: cars }, { data: mods }] = await Promise.all([
    supabase.from("cars").select("id, name, slug").in("id", carIds).eq("owner_id", user.id),
    supabase.from("mod_items").select("id, car_id, brand, product").in("id", modIds),
  ]);
  const carOf = new Map((cars ?? []).map((car) => [car.id, car]));
  const modOf = new Map((mods ?? []).map((mod) => [mod.id, mod]));
  return drafts.flatMap((draft) => {
    const car = carOf.get(draft.car);
    if (!car) return [];
    const applied = modOf.get(draft.id)?.car_id === car.id;
    const old = draft.replaces ? modOf.get(draft.replaces) : undefined;
    const replaces = old && old.car_id === car.id ? [old.brand, old.product].filter(Boolean).join(" ") || "the old part" : null;
    return [
      {
        kind: "build_change" as const,
        id: draft.id,
        carName: car.name,
        part: [draft.brand, draft.product].filter(Boolean).join(" "),
        replaces,
        image: draft.image_url,
        applied,
        href: `/cars/${car.slug}`,
        editHref: `/garage/${car.id}/edit?change=${draft.id}#mods`,
        sellHref: applied && old && replaces ? `/sell?car=${car.id}&mod=${old.id}` : null,
      },
    ];
  });
}
