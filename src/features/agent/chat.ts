"use server";

import { redirect } from "next/navigation";

import { agentStepOpen } from "@/lib/agent/beta";
import { modelContext, type AgentScope } from "@/lib/agent/context";
import { capture } from "@/lib/analytics";
import { runAgentTurn, type TurnCard, type TurnImage } from "@/lib/ai/run";
import { isOwnedStorageUrl } from "@/lib/media-url";
import { resolveCards, type ResolvedCard } from "./cards";
import { loadChat, resolveAbout, type ChatAbout } from "./chat-load";
import { reportError } from "@/lib/monitoring";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ChatMessage = { id: string; role: "member" | "agent"; body: string; cards: ResolvedCard[]; images: string[]; created_at: string };
export type ChatState = { error?: string; messages?: ChatMessage[] };

const MAX_LENGTH = 4000;
const HISTORY = 20;
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * The photos as the model gets them: read back from DRVN's own storage (the
 * URLs are checked as the member's own first, so this fetches nothing else),
 * re-encoded on upload, and sent as data rather than a link. One that can't
 * be read is left out rather than failing the message.
 */
async function loadImages(urls: string[]): Promise<TurnImage[]> {
  const loaded = await Promise.all(
    urls.map(async (url): Promise<TurnImage | null> => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const type = response.headers.get("content-type")?.split(";")[0] ?? "";
        if (!response.ok || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) return null;
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength > MAX_PHOTO_BYTES) return null;
        return { url, mediaType: type as TurnImage["mediaType"], data: bytes.toString("base64") };
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter((image): image is TurnImage => image !== null);
}

/** What the member reads when the model didn't answer: plain, and never the error. */
const FALLBACK: Record<string, string> = {
  spend_cap: "I've reached today's limit for answering. Try again tomorrow, or open the offer or listing directly.",
  paused: "Your agent is paused right now. Everything it does is also on the listing and offer pages.",
  ai_disabled: "Chat isn't switched on here yet. Everything I do is also on the listing and offer pages.",
  refused: "I can't help with that one. I can look things up on DRVN for you: parts, your car, what fits and what things sell for.",
  incomplete: "That took more steps than I can do at once. Try asking one thing at a time.",
  not_allowed: "I can't do that from chat.",
  model_error: "Something went wrong on my side. Try again in a moment.",
};

/**
 * One message to the member's agent (A3c). The member can't write chat rows
 * themselves: this action, after their own sign-in, stores their message,
 * runs one model turn through runAgentTurn — their own client for every
 * read, R1 at most, spend-capped, their text redacted — and stores the reply
 * with its cards. The model never moves money or limits from here (AG-5).
 */
export async function sendAgentMessage(input: { text: string; scope?: AgentScope; about?: { kind: string; id: string }; images?: string[] }): Promise<ChatState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/agent");
  if (!(await agentStepOpen("chat"))) return { error: "Chat with your agent isn't open yet." };

  // Photos (A3d) only once the jobs step is open, and only the member's own
  // listing-images uploads; the database checks the folder again.
  const jobs = await agentStepOpen("jobs");
  const images = jobs ? (input.images ?? []).filter((url) => isOwnedStorageUrl(url, user.id) && url.includes("/listing-images/")).slice(0, MAX_PHOTOS) : [];
  if ((input.images?.length ?? 0) > images.length) return { error: "Those photos can't be sent here. Add them again." };
  const text = input.text.trim() || (images.length ? "What's in these photos?" : "");
  if (!text) return { error: "Type a message first." };
  if (text.length > MAX_LENGTH) return { error: `Keep it under ${MAX_LENGTH} characters.` };
  if (!(await allowAction(RATE_LIMITS.agentChat, user.id))) return { error: rateLimitMessage(RATE_LIMITS.agentChat) };

  // History first (the member's last turns, oldest first; runAgentTurn redacts
  // them again before the model sees them), then both sides stored through
  // agent_chat_append: the service role reads these tables but writes them
  // only through that function (20261025100000).
  const admin = createAdminClient();
  const { data: prior } = await admin
    .from("agent_messages")
    .select("role, body")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY);

  const mine = await admin.rpc("agent_chat_append", { p_owner: user.id, p_role: "member", p_body: text, p_images: images }).single();
  if (mine.error || !mine.data) {
    reportError("[agent] message not stored", { code: mine.error?.code });
    return { error: "Couldn't send that. Try again." };
  }

  const history = [...(prior ?? [])].reverse().map((row) => ({
    role: row.role === "member" ? ("user" as const) : ("assistant" as const),
    content: row.body,
  }));
  // What the member opened the agent from, read as them; the model gets the
  // kind and id only (it reads the rest through its tools, as untrusted data).
  const about = await resolveAbout(supabase, user.id, input.about);
  const modelMessage = about ? `${text}\n\n(Asked from ${about.mine ? "their own" : "a"} ${about.kind}: ${about.kind === "listing" ? "listingId" : "carId"} ${about.id}.)` : text;
  const turn = await runAgentTurn({ context: modelContext(user.id, input.scope ?? "buyer"), supabase, message: modelMessage, history, jobs, images: await loadImages(images) });
  const replyBody = turn.ok ? turn.text || "Done." : FALLBACK[turn.code] ?? FALLBACK.model_error;
  const replyCards = turn.ok ? turn.cards : [];

  const reply = await admin
    .rpc("agent_chat_append", { p_owner: user.id, p_role: "agent", p_body: replyBody.slice(0, 8000), p_cards: replyCards })
    .single();
  if (reply.error || !reply.data) reportError("[agent] reply not stored", { code: reply.error?.code });

  capture(user.id, { event: "agent_chat_turn", props: { tool_calls: Math.min(turn.toolCalls.length, 9), ok: turn.ok } });
  const resolved = await resolveCards(supabase, replyCards);
  return {
    messages: [mine.data, ...(reply.data ? [reply.data] : [])].map((row) => ({
      id: row.id,
      role: row.role as ChatMessage["role"],
      body: row.body,
      cards: ((row.cards ?? []) as TurnCard[]).flatMap((card) => (resolved.has(card.id) ? [resolved.get(card.id)!] : [])),
      images: row.images ?? [],
      created_at: row.created_at,
    })),
  };
}

/**
 * The side panel's thread (A3c): the same last 50 messages /agent shows, and
 * what the opener asked about, read as the member. Loaded when the panel
 * first opens, never with every page.
 */
export async function openAgentChat(about?: { kind: string; id: string } | null): Promise<{ messages: ChatMessage[]; about: ChatAbout | null; jobs: boolean; userId: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await agentStepOpen("chat"))) return null;
  const [messages, resolved, jobs] = await Promise.all([loadChat(supabase, user.id), resolveAbout(supabase, user.id, about), agentStepOpen("jobs")]);
  return { messages, about: resolved, jobs, userId: user.id };
}
