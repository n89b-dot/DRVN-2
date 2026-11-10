import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import type { TurnCard } from "@/lib/ai/run";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/mods/parse";
import { signChatPhotos } from "@/lib/agent/chat-photos";
import { signedPhotoObject } from "@/lib/photo-urls";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedPhotoUrls } from "@/lib/supabase/photo-signing";
import { safeProductLink, type SafeLink } from "@/lib/mods/safe-link";

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
      /**
       * The product link the change saves, as Confirm will save it: its host
       * and full address, shown on the card (N124). Null when there is none.
       */
      link: SafeLink | null;
      /** The draft carried a link that isn't a safe web address: it is left off, and the card says so. */
      linkLeftOff: boolean;
      /** Saved: a mod line with the draft's id is on the car. */
      applied: boolean;
      /** The car's build page once saved; the mods editor with the line filled in before. */
      href: string;
      editHref: string;
      /** "List the old one", once saved and only when something came off. */
      sellHref: string | null;
    }
  | {
      kind: "build_list";
      id: string;
      carName: string;
      lines: number;
      /** Lines the parser wasn't sure of: flagged in the editor. */
      toCheck: number;
      applied: boolean;
      href: string;
      editHref: string;
    }
  | {
      kind: "list_part";
      id: string;
      carName: string;
      part: string;
      /** The sell form prefilled from the line, or the listing once it's up. */
      href: string;
      listed: boolean;
    }
  | { kind: "marketplace"; id: string; query: string; count: number; capped: boolean; href: string }
  | {
      /** "Listing from photos": opens the sell form filled in. */
      kind: "listing_draft";
      id: string;
      title: string;
      image: string | null;
      photos: number;
      href: string;
    }
  | {
      /** "Post an update": opens the update composer filled in. */
      kind: "update_draft";
      id: string;
      carName: string;
      title: string;
      image: string | null;
      href: string;
    };

type BuildCard = Extract<TurnCard, { kind: "build_change" }>;
type ListCard = Extract<TurnCard, { kind: "build_list" }>;
type PartCard = Extract<TurnCard, { kind: "list_part" }>;
type UpdateCard = Extract<TurnCard, { kind: "update_draft" }>;

/** Below this the parser's line is flagged for a look, as in the editor. */
const CHECK_BELOW = LOW_CONFIDENCE_THRESHOLD;

/**
 * Turns stored card ids (agent_messages.cards) into what the thread shows,
 * through the member's own client, so a card never shows something the
 * member couldn't open themselves. Gone or hidden listings drop out.
 */
export async function resolveCards(supabase: SupabaseClient<Database>, cards: TurnCard[]): Promise<Map<string, ResolvedCard>> {
  const resolved = new Map<string, ResolvedCard>();
  // A Marketplace search is public and holds its own link: nothing to read.
  for (const card of cards) if (card.kind === "marketplace") resolved.set(card.id, { ...card });
  const [, builds, jobs, photos] = await Promise.all([
    resolveListings(supabase, cards, resolved),
    resolveBuildChanges(supabase, cards),
    resolveJobCards(supabase, cards),
    resolvePhotoDrafts(supabase, cards),
  ]);
  for (const card of [...builds, ...jobs, ...photos]) resolved.set(card.id, card);
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
  // The thumbnail comes from the model's card, not from a guarded column, so
  // it is signed only when it is the member's own upload (N940); anything
  // else stays as written, and a member photo in it stays canonical.
  const own = drafts.flatMap((draft) => (draft.image_url && signedPhotoObject(draft.image_url)?.path.split("/")[0] === user.id ? [draft.image_url] : []));
  const signed = own.length ? await signedPhotoUrls(own) : new Map<string, string>();
  return drafts.flatMap((draft) => {
    const car = carOf.get(draft.car);
    if (!car) return [];
    const applied = modOf.get(draft.id)?.car_id === car.id;
    const old = draft.replaces ? modOf.get(draft.replaces) : undefined;
    const replaces = old && old.car_id === car.id ? [old.brand, old.product].filter(Boolean).join(" ") || "the old part" : null;
    const link = safeProductLink(draft.product_url);
    return [
      {
        kind: "build_change" as const,
        id: draft.id,
        carName: car.name,
        part: [draft.brand, draft.product].filter(Boolean).join(" "),
        replaces,
        image: draft.image_url ? (signed.get(draft.image_url) ?? draft.image_url) : draft.image_url,
        link,
        linkLeftOff: Boolean(draft.product_url) && !link,
        applied,
        href: `/cars/${car.slug}`,
        editHref: `/garage/${car.id}/edit?change=${draft.id}#mods`,
        sellHref: applied && old && replaces ? `/sell?car=${car.id}&mod=${old.id}` : null,
      },
    ];
  });
}

/**
 * A3d's cards, on the member's own cars: a parsed build list (saved once
 * every line is on the car) and a part that came off (the sell form, or its
 * listing once it's up; dropped if it went back on the car).
 */
async function resolveJobCards(supabase: SupabaseClient<Database>, cards: TurnCard[]): Promise<ResolvedCard[]> {
  const lists = cards.filter((card): card is ListCard => card.kind === "build_list");
  const parts = cards.filter((card): card is PartCard => card.kind === "list_part");
  if (!lists.length && !parts.length) return [];
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const carIds = [...new Set([...lists, ...parts].map((card) => card.car))];
  const modIds = [...new Set([...lists.flatMap((list) => list.lines.map((line) => line.id)), ...parts.map((part) => part.id)])];
  const [{ data: cars }, { data: mods }] = await Promise.all([
    supabase.from("cars").select("id, name, slug").in("id", carIds).eq("owner_id", user.id),
    supabase.from("mod_items").select("id, car_id, brand, product, status, linked_listing_id").in("id", modIds),
  ]);
  const carOf = new Map((cars ?? []).map((car) => [car.id, car]));
  const modOf = new Map((mods ?? []).map((mod) => [mod.id, mod]));
  const out: ResolvedCard[] = [];
  for (const list of lists) {
    const car = carOf.get(list.car);
    if (!car) continue;
    out.push({
      kind: "build_list",
      id: list.id,
      carName: car.name,
      lines: list.lines.length,
      toCheck: list.lines.filter((line) => line.confidence < CHECK_BELOW).length,
      applied: list.lines.every((line) => modOf.get(line.id)?.car_id === car.id),
      href: `/cars/${car.slug}`,
      editHref: `/garage/${car.id}/edit?change=${list.id}#mods`,
    });
  }
  for (const part of parts) {
    const car = carOf.get(part.car);
    const mod = modOf.get(part.id);
    if (!car || !mod || mod.car_id !== car.id || mod.status !== "removed") continue;
    out.push({
      kind: "list_part",
      id: part.id,
      carName: car.name,
      part: [mod.brand, mod.product].filter(Boolean).join(" ") || "A part",
      href: mod.linked_listing_id ? `/listings/${mod.linked_listing_id}` : `/sell?car=${car.id}&mod=${mod.id}`,
      listed: Boolean(mod.linked_listing_id),
    });
  }
  return out;
}

/**
 * The photo drafts (A3d). They only ever come from the member's own chat, so
 * a listing draft needs no read; an update draft is shown only for a car
 * that's still theirs.
 */
async function resolvePhotoDrafts(supabase: SupabaseClient<Database>, cards: TurnCard[]): Promise<ResolvedCard[]> {
  const out: ResolvedCard[] = [];
  // R81: a draft's first photo is a private chat photo, shown signed.
  const firsts = cards.flatMap((card) => (card.kind === "listing_draft" || card.kind === "update_draft") && card.images[0] ? [card.images[0]] : []);
  const signed = firsts.length ? await signChatPhotos(createAdminClient(), firsts) : new Map<string, string>();
  const shown = (url: string | undefined) => (url ? (signed.get(url) ?? null) : null);
  for (const card of cards) {
    if (card.kind !== "listing_draft") continue;
    out.push({ kind: "listing_draft", id: card.id, title: card.title, image: shown(card.images[0]), photos: card.images.length, href: `/sell?agent=${card.id}` });
  }
  const updates = cards.filter((card): card is UpdateCard => card.kind === "update_draft");
  if (!updates.length) return out;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return out;
  const { data: cars } = await supabase.from("cars").select("id, name").in("id", [...new Set(updates.map((card) => card.car))]).eq("owner_id", user.id);
  const carOf = new Map((cars ?? []).map((car) => [car.id, car]));
  for (const card of updates) {
    const car = carOf.get(card.car);
    if (!car) continue;
    out.push({ kind: "update_draft", id: card.id, carName: car.name, title: card.title, image: shown(card.images[0]), href: `/garage/${car.id}/update/new?agent=${card.id}` });
  }
  return out;
}
