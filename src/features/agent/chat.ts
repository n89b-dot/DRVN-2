"use server";

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { agentStepOpen } from "@/lib/agent/beta";
import { modelContext, type AgentScope } from "@/lib/agent/context";
import { loadAgentMode } from "@/lib/agent/member-mode";
import { agentModeAllowsChat, agentModeRefusal } from "@/lib/agent/mode";
import { capture } from "@/lib/analytics";
import { runAgentTurn, type TurnCard, type TurnImage } from "@/lib/ai/run";
import { isOwnedStorageUrl } from "@/lib/media-url";
import { resolveCards, type ResolvedCard } from "./cards";
import { loadChat, resolveAbout, type ChatAbout } from "./chat-load";
import { reportError } from "@/lib/monitoring";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SUSPENDED_MESSAGE } from "@/lib/suspension";

export type ChatMessage = { id: string; role: "member" | "agent"; body: string; cards: ResolvedCard[]; images: string[]; created_at: string };
export type ChatState = {
  error?: string;
  messages?: ChatMessage[];
  /** The chat was cleared while this send ran: show nothing from it. */
  cleared?: boolean;
};

const MAX_LENGTH = 4000;
const HISTORY = 20;
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** One send, end to end: the model's share is TURN_TIMEOUT_MS at most, inside this. Well under the platform's own limit. */
const CHAT_TURN_DEADLINE_MS = 120_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The photos as the model gets them: read back from DRVN's own storage (the
 * URLs are checked as the member's own first, so this fetches nothing else),
 * re-encoded on upload, and sent as data rather than a link. One that can't
 * be read is left out rather than failing the message.
 */
async function loadImages(urls: string[], deadline: AbortSignal): Promise<TurnImage[]> {
  const loaded = await Promise.all(
    urls.map(async (url): Promise<TurnImage | null> => {
      try {
        const response = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(10_000), deadline]) });
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
  suspended: SUSPENDED_MESSAGE,
  timeout: "That took too long, so I stopped. Try again, or ask one thing at a time.",
  ai_disabled: "Chat isn't switched on here yet. Everything I do is also on the listing and offer pages.",
  refused: "I can't help with that one. I can look things up on DRVN for you: parts, your car, what fits and what things sell for.",
  incomplete: "That took more steps than I can do at once. Try asking one thing at a time.",
  not_allowed: "I can't do that from chat.",
  model_error: "Something went wrong on my side. Try again in a moment.",
};

type StoredMessage = { id: string; role: string; body: string; cards: unknown; images: string[] | null; created_at: string };

/**
 * One message to the member's agent (A3c). The member can't write chat rows
 * themselves: this action, after their own sign-in, stores their message,
 * runs one model turn through runAgentTurn — their own client for every
 * read, R1 at most, spend-capped, their text redacted — and stores the reply
 * with its cards. The model never moves money or limits from here (AG-5).
 *
 * OS-W04: a suspended member is refused before anything is stored, fetched,
 * reserved or sent (N127; agent_chat_turn_begin and agent_spend_reserve
 * refuse them again in the database). The whole send has one deadline,
 * CHAT_TURN_DEADLINE_MS (N121). `requestId` is the client's id for this
 * send: the same id sent again replays the stored turn instead of storing
 * the message twice and calling the model again.
 */
export async function sendAgentMessage(input: { text: string; scope?: AgentScope; about?: { kind: string; id: string }; images?: string[]; requestId?: string }): Promise<ChatState> {
  const deadline = Date.now() + CHAT_TURN_DEADLINE_MS;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/agent");
  if (!(await agentStepOpen("chat"))) return { error: "Chat with your agent isn't open yet." };
  // Suspended first: nothing below runs for them. Unknown counts as suspended.
  const suspended = await supabase.rpc("is_suspended", { uid: user.id });
  if (suspended.error) return { error: "Couldn't send that. Try again." };
  if (suspended.data === true) return { error: SUSPENDED_MESSAGE };
  // AG-7: an agent set to Off answers nothing, from /agent or the side panel
  // (readiness 64). Refused before anything is stored or sent.
  const mode = await loadAgentMode(user.id);
  if (!agentModeAllowsChat(mode)) return { error: agentModeRefusal(mode) ?? "Agent is off in Settings." };

  // Photos (A3d) only once the jobs step is open, and only the member's own
  // listing-images uploads; the database checks the folder again.
  const jobs = await agentStepOpen("jobs");
  const images = jobs ? (input.images ?? []).filter((url) => isOwnedStorageUrl(url, user.id) && url.includes("/listing-images/")).slice(0, MAX_PHOTOS) : [];
  if ((input.images?.length ?? 0) > images.length) return { error: "Those photos can't be sent here. Add them again." };
  const text = input.text.trim() || (images.length ? "What's in these photos?" : "");
  if (!text) return { error: "Type a message first." };
  if (text.length > MAX_LENGTH) return { error: `Keep it under ${MAX_LENGTH} characters.` };
  if (input.requestId !== undefined && !UUID.test(input.requestId)) return { error: "Couldn't send that. Try again." };
  const requestId = input.requestId ?? randomUUID();
  if (!(await allowAction(RATE_LIMITS.agentChat, user.id))) return { error: rateLimitMessage(RATE_LIMITS.agentChat) };

  // The member's message, once per request id, through agent_chat_turn_begin:
  // the service role reads these tables but writes them only through the
  // chat functions (20261025100000, 20261107100000).
  const admin = createAdminClient();
  const begun = await admin.rpc("agent_chat_turn_begin", { p_owner: user.id, p_request: requestId, p_body: text, p_images: images });
  if (begun.error || !begun.data) {
    if (begun.error?.code === "42501") return { error: SUSPENDED_MESSAGE };
    // Off saved in another tab after the read above: the database's own
    // check, under the member's lock (R-agentmode, 20261107190000).
    if (begun.error?.code === "AG009") return { error: agentModeRefusal("off") ?? "Agent is off in Settings." };
    reportError("[agent] message not stored", { code: begun.error?.code });
    return { error: "Couldn't send that. Try again." };
  }
  const turn0 = begun.data as { replayed: boolean; member: StoredMessage | null; reply: StoredMessage | null };
  if (!turn0.member) {
    reportError("[agent] message not stored", { code: "no_member_row" });
    return { error: "Couldn't send that. Try again." };
  }
  if (turn0.replayed) {
    // The same send again: what it already produced, and no second model call.
    const replayCards = ((turn0.reply?.cards ?? []) as TurnCard[]);
    const resolved = await resolveCards(supabase, replayCards);
    return {
      messages: toChatMessages([turn0.member, ...(turn0.reply ? [turn0.reply] : [])], resolved),
      ...(turn0.reply ? {} : { error: "Your agent is still answering that. Its reply will appear here when it's done." }),
    };
  }

  // History: the member's last turns before this one, oldest first, as
  // stored. runAgentTurn redacts every one of them before the model sees it.
  const { data: prior } = await admin
    .from("agent_messages")
    .select("role, body")
    .eq("owner_id", user.id)
    .neq("id", turn0.member.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY);
  const history = [...(prior ?? [])].reverse().map((row) => ({
    role: row.role === "member" ? ("user" as const) : ("assistant" as const),
    content: row.body,
  }));
  // What the member opened the agent from, read as them; the model gets the
  // kind and id only (it reads the rest through its tools, as untrusted data).
  const about = await resolveAbout(supabase, user.id, input.about);
  const modelMessage = about ? `${text}\n\n(Asked from ${about.mine ? "their own" : "a"} ${about.kind}: ${about.kind === "listing" ? "listingId" : "carId"} ${about.id}.)` : text;
  const deadlineSignal = AbortSignal.timeout(Math.max(0, deadline - Date.now()));
  const turn = await runAgentTurn({
    context: modelContext(user.id, input.scope ?? "buyer"),
    supabase,
    message: modelMessage,
    history,
    jobs,
    images: await loadImages(images, deadlineSignal),
    deadline,
    signal: deadlineSignal,
  });
  const replyBody = turn.ok ? turn.text || "Done." : FALLBACK[turn.code] ?? FALLBACK.model_error;
  const replyCards = turn.ok ? turn.cards : [];

  const reply = await admin.rpc("agent_chat_turn_finish", { p_owner: user.id, p_request: requestId, p_body: replyBody.slice(0, 8000), p_cards: replyCards });
  // The member cleared the chat while this turn ran (N125): their message is
  // gone, so the request has no member message and nothing is stored. Return
  // nothing either, or the deleted message would come back on screen.
  if (reply.error?.code === "P0002") return { messages: [], cleared: true };
  if (reply.error || !reply.data) reportError("[agent] reply not stored", { code: reply.error?.code });
  const stored = (reply.data ?? null) as StoredMessage | null;

  capture(user.id, { event: "agent_chat_turn", props: { tool_calls: Math.min(turn.toolCalls.length, 9), ok: turn.ok } });
  const resolved = await resolveCards(supabase, ((stored?.cards ?? []) as TurnCard[]));
  return { messages: toChatMessages([turn0.member, ...(stored ? [stored] : [])], resolved) };
}

function toChatMessages(rows: StoredMessage[], resolved: Map<string, ResolvedCard>): ChatMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role as ChatMessage["role"],
    body: row.body,
    cards: ((row.cards ?? []) as TurnCard[]).flatMap((card) => (resolved.has(card.id) ? [resolved.get(card.id)!] : [])),
    images: row.images ?? [],
    created_at: row.created_at,
  }));
}

/**
 * The side panel's thread (A3c): the same last 50 messages /agent shows, and
 * what the opener asked about, read as the member. Loaded when the panel
 * first opens, never with every page.
 */
export async function openAgentChat(
  about?: { kind: string; id: string } | null,
): Promise<{ messages: ChatMessage[]; about: ChatAbout | null; jobs: boolean; userId: string } | { disabled: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await agentStepOpen("chat"))) return null;
  // AG-7: Off in Settings closes the panel's chat too, saying where to change it.
  const mode = await loadAgentMode(user.id);
  if (!agentModeAllowsChat(mode)) return { disabled: agentModeRefusal(mode) ?? "Agent is off in Settings." };
  const [messages, resolved, jobs] = await Promise.all([loadChat(supabase, user.id), resolveAbout(supabase, user.id, about), agentStepOpen("jobs")]);
  return { messages, about: resolved, jobs, userId: user.id };
}
