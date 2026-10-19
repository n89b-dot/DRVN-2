"use server";

import { agentStepOpen } from "@/lib/agent/beta";
import { sentenceToFilters } from "@/lib/ai/sentence-filters";
import { capture } from "@/lib/analytics";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { getViewer } from "@/lib/supabase/page-context";

/**
 * "Turn this into filters" (A4) on the Marketplace: the member's search
 * sentence becomes the Marketplace's own filters, as a URL the page opens
 * (its chips then remove any one of them). Signed-in, once the chat step is
 * open, and spend-capped with chat.
 */
export async function filtersFromSentence(sentence: string): Promise<{ href?: string; error?: string }> {
  const user = await getViewer();
  if (!user || !(await agentStepOpen("chat"))) return { error: "Not available here." };
  const text = (sentence ?? "").trim();
  if (text.length < 3 || text.length > 300) return { error: "Describe what you're after in a sentence." };
  if (!(await allowAction(RATE_LIMITS.agentChat, user.id))) return { error: rateLimitMessage(RATE_LIMITS.agentChat) };
  const result = await sentenceToFilters({ ownerId: user.id, sentence: text });
  capture(user.id, { event: "marketplace_sentence_filters", props: { ok: result.ok } });
  if (result.ok) return { href: result.href };
  if (result.code === "spend_cap") return { error: "That's today's limit for this. Use the filters, or try tomorrow." };
  if (result.code === "nothing") return { error: "Couldn't find filters in that. Try naming the part." };
  return { error: "Couldn't do that just now. The filters below still work." };
}
