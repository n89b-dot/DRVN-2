import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { TurnCard } from "@/lib/ai/run";
import type { Database } from "@/lib/database.types";

import { resolveCards } from "./cards";
import type { ChatMessage } from "./chat";

/**
 * The member's agent chat, as /agent and the side panel show it: the last
 * 50 messages, oldest first, read as the member (owner-only), with their
 * cards resolved the same way.
 */
export async function loadChat(supabase: SupabaseClient<Database>, ownerId: string): Promise<ChatMessage[]> {
  const { data: rows } = await supabase
    .from("agent_messages")
    .select("id, role, body, cards, created_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(50);
  const cards = await resolveCards(supabase, (rows ?? []).flatMap((row) => (row.cards ?? []) as TurnCard[]));
  return [...(rows ?? [])].reverse().map((row) => ({
    id: row.id,
    role: row.role as ChatMessage["role"],
    body: row.body,
    cards: ((row.cards ?? []) as TurnCard[]).flatMap((card) => (cards.has(card.id) ? [cards.get(card.id)!] : [])),
    created_at: row.created_at,
  }));
}

/** What a message is about: the listing or car the member opened the agent from. */
export type ChatAbout = { kind: "listing" | "car"; id: string; label: string; mine: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads an `about` (from `?about=listing:<id>`, or the panel's opener) as the
 * member: a listing they can see, or a car of their own. Anything else is
 * dropped, so the context chip never names something they couldn't open.
 */
export async function resolveAbout(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  about: { kind?: unknown; id?: unknown } | null | undefined,
): Promise<ChatAbout | null> {
  if (!about || typeof about.id !== "string" || !UUID.test(about.id)) return null;
  if (about.kind === "listing") {
    const { data } = await supabase.from("listings").select("id, title, seller_id").eq("id", about.id).maybeSingle();
    return data ? { kind: "listing", id: data.id, label: data.title, mine: data.seller_id === ownerId } : null;
  }
  if (about.kind === "car") {
    const { data } = await supabase.from("cars").select("id, name").eq("id", about.id).eq("owner_id", ownerId).maybeSingle();
    return data ? { kind: "car", id: data.id, label: data.name, mine: true } : null;
  }
  return null;
}

/** `listing:<id>` or `car:<id>`, as the full page's `?about=` carries it. */
export function parseAbout(raw: string | undefined): { kind: string; id: string } | null {
  const match = /^(listing|car):([0-9a-f-]{36})$/i.exec(raw ?? "");
  return match ? { kind: match[1].toLowerCase(), id: match[2] } : null;
}
