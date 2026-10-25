import "server-only";

import { randomUUID } from "node:crypto";

import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";

import { riskAtMost, type AgentContext, type AgentScope } from "@/lib/agent/context";
import { agentModelHalted } from "@/lib/agent/controls";
import type { z } from "zod";

import type { draftBuildList, draftCarUpdate, draftListingFromPhotos, findPartsToList, proposeBuildChange } from "@/lib/capabilities/build";
import type { browseMarketplace } from "@/lib/capabilities/reads";
import { JOB_TOOLS, modelToolsFor } from "@/lib/capabilities/registry";
import { CapabilityError, invokeCapability, type MemberClient } from "@/lib/capabilities/types";
import { reportError } from "@/lib/monitoring";

import { anthropicClient } from "./client";
import { estimateCostUsd, resolveAiConfig, type AiConfig } from "./config";
import { redactForModel } from "./redact";
import { UNTRUSTED_RULE, wrapToolResult } from "./untrusted";
import { databaseLedger, type SpendLedger } from "./spend";
import { logUsage, usageRecord } from "./usage";

/**
 * One agent turn, around the SDK's tool runner (agent plan A2, `run.ts`).
 * Built and tested here, first used by members in A3c.
 *
 * - The model gets only the read and draft tools allow-listed for the scope
 *   (capabilities/registry.ts), each run through invokeCapability with the
 *   member's own client, so row security still decides what it sees.
 * - It never gets a money or limits tool, and it is never told a limit: rules
 *   set prices (AG-5), so nothing it reads or is tricked into saying can move one.
 * - What the member typed is redacted (cards, VINs, emails, phones) before it
 *   is sent — this turn and every earlier turn in the history, since storage
 *   keeps them (agent-data-rules.md §3); every tool result goes back as
 *   untrusted data.
 * - The usage log keeps the model, tokens, cost and task, never the content;
 *   it is stored per task (agent_usage), and a turn past the member's or the
 *   global daily cap is refused before the model is called (spend.ts). One
 *   turn is also bounded on its own: TURN_CAP_USD and TURN_TIMEOUT_MS cut it
 *   short, and what it used is recorded even when it failed.
 * - An admin kill switch that names this member, or everyone, stops the
 *   model too (agent/controls.ts), not only the worker's writes.
 */

/** The most one turn may cost before it is cut short, whatever the daily caps still allow. */
export const TURN_CAP_USD = 0.5;
/** The longest one turn may run; the server action it serves has twice this. */
export const TURN_TIMEOUT_MS = 90_000;

export type ToolCall = { name: string; ok: boolean; code?: string };

/**
 * What a reply points at, for result cards (agent_messages.cards): a listing
 * by id, or a drafted build change for the member to confirm (the draft's
 * own fields, from propose_build_change; never a price or a limit).
 */
export type TurnCard =
  | { kind: "listing"; id: string }
  | MarketplaceCard
  | {
      kind: "build_change";
      /** The new mod line's id, so a repeated Confirm saves the same line. */
      id: string;
      car: string;
      replaces: string | null;
      brand: string | null;
      product: string;
      part_number: string | null;
      category: string | null;
      product_url: string | null;
      image_url: string | null;
    }
  | {
      /** "Paste your build" (A3d): parsed lines, each with the id it saves under. */
      kind: "build_list";
      id: string;
      car: string;
      lines: { id: string; group_label: string; brand: string | null; product: string | null; part_number: string | null; category: string | null; confidence: number }[];
    }
  | {
      /** "List the parts that came off" (A3d): a removed, unlisted mod line by id. */
      kind: "list_part";
      id: string;
      car: string;
    }
  | {
      /** "Listing from photos" (A3d): what the photos show; never a price or condition. */
      kind: "listing_draft";
      id: string;
      title: string;
      brand: string | null;
      part_number: string | null;
      category: string | null;
      images: string[];
    }
  | {
      /** "Post an update" (A3d): a draft for the update composer. */
      kind: "update_draft";
      id: string;
      car: string;
      title: string;
      body: string;
      images: string[];
      mods: string[];
    };

/** "Ask about DRVN" (A4): a Marketplace search it counted, as a link. */
export type MarketplaceCard = { kind: "marketplace"; id: string; query: string; href: string; count: number; capped: boolean };

/** A photo on the member's message, as the model receives it. */
export type TurnImage = { url: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string };
const MAX_CARDS = 5;

export type AgentTurnResult =
  | { ok: true; text: string; toolCalls: ToolCall[]; cards: TurnCard[]; stopReason: string | null }
  | { ok: false; code: "ai_disabled" | "model_error" | "refused" | "incomplete" | "not_allowed" | "spend_cap" | "paused"; toolCalls: ToolCall[] };

type RunnerClient = Pick<Anthropic, "beta">;

/** Earlier turns as the model gets them: stored bodies carry VINs, emails and phones; the model never does. */
export function redactHistory(history: Anthropic.Beta.BetaMessageParam[]): Anthropic.Beta.BetaMessageParam[] {
  return history.map((message) => {
    if (typeof message.content === "string") return { ...message, content: redactForModel(message.content) };
    return {
      ...message,
      content: message.content.map((block) => (block.type === "text" ? { ...block, text: redactForModel(block.text) } : block)),
    };
  });
}

/** The member's turn: their photos first, numbered as the tools see them, then their words (redacted). */
function userContent(message: string, images: TurnImage[] | undefined): Anthropic.Beta.BetaMessageParam["content"] {
  const text = redactForModel(message);
  if (!images?.length) return text;
  return [
    ...images.flatMap((image, index) => [
      { type: "text" as const, text: `Photo ${index}:` },
      { type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.data } },
    ]),
    { type: "text" as const, text },
  ];
}

/** Whether `url` is a link the member typed in this message (same host and path). */
export function linkInMessage(url: unknown, message: string): boolean {
  if (typeof url !== "string") return false;
  let wanted: URL;
  try {
    wanted = new URL(url);
  } catch {
    return false;
  }
  const key = (link: URL) => `${link.hostname.replace(/^www\./, "").toLowerCase()}${link.pathname.replace(/\/$/, "")}`;
  for (const match of message.match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
    try {
      if (key(new URL(match.replace(/[).,!?]+$/, ""))) === key(wanted)) return true;
    } catch {
      // not a link after all
    }
  }
  return false;
}

const SCOPE_JOB: Record<AgentScope, string> = {
  seller: "You help the member sell their parts on DRVN: understand what they want, look things up, and explain what happened in plain words.",
  buyer: "You help the member find and buy parts that fit their car on DRVN, and keep their Garage's build up to date: understand what they want, look things up, and explain what happened in plain words.",
  garage: "You help the member keep their Garage up to date on DRVN: their cars and the parts on them.",
};

export function agentSystemPrompt(scope: AgentScope, jobs = false): string {
  return [
    "You are the member's DRVN agent. You speak only to the member who owns you; you never write to anyone else.",
    SCOPE_JOB[scope],
    "You never choose a price, a counter or a limit, and you never accept, pay or move money: DRVN's rules do that, and you may explain an outcome the rules already decided.",
    "Use the tools to look things up. When a tool says there isn't enough evidence, say so plainly; don't guess fitment or prices.",
    "For questions about what's on DRVN (how many of something are for sale, under what price), use browse_marketplace and give its count; it only sees public listings, and you never have anyone else's private data.",
    "When the member says a part went on or came off one of their cars, or pastes a product link for one, draft it with propose_build_change (read_part_link first for a link, list_my_cars and read_my_car to find the car and the part it replaces). It isn't saved until they tap Confirm on the card, so say that rather than that it's done.",
    ...(jobs
      ? [
          "When they paste a whole build list, use draft_build_list with their text as it is; when they want to sell what came off, use find_parts_to_list. Each ends in a card they act on; you never list, price or describe a part's condition for them.",
          "Photos on their message are numbered from 0 in the order sent. To list a part from them use draft_listing_from_photos; to post about their car use draft_car_update. Say only what the photos show; ask about anything you can't see, such as condition or mileage, rather than guessing.",
        ]
      : []),
    UNTRUSTED_RULE,
    "Keep replies short and concrete.",
  ].join("\n\n");
}

export async function runAgentTurn(options: {
  context: AgentContext;
  supabase: MemberClient;
  message: string;
  history?: Anthropic.Beta.BetaMessageParam[];
  taskId?: string | null;
  client?: RunnerClient;
  config?: AiConfig;
  /** The spend caps and usage store; the database's by default. */
  spend?: SpendLedger;
  /** Whether a kill switch stops this member's model calls; the database's switches by default (tests pass their own with their client). */
  halted?: (ownerId: string) => Promise<boolean>;
  /** The jobs step is open (A3d): its tools join the model's. */
  jobs?: boolean;
  /** The member's photos on this message (A3d), already loaded: sent with it, and the only photos a draft may use. */
  images?: TurnImage[];
}): Promise<AgentTurnResult> {
  const config = options.config ?? resolveAiConfig();
  const toolCalls: ToolCall[] = [];
  const cards: TurnCard[] = [];
  const addCard = (card: TurnCard) => {
    if (cards.length < MAX_CARDS && !cards.some((c) => c.kind === card.kind && c.id === card.id)) cards.push(card);
  };
  // The model works at R1 at most, whatever the caller's context allows.
  if (!riskAtMost(options.context.permissions.maxRisk, "R1")) return { ok: false, code: "not_allowed", toolCalls };
  if (config.mode === "disabled") return { ok: false, code: "ai_disabled", toolCalls };
  if (config.mode === "stub" && !options.client) {
    return { ok: true, text: "I can't reach the model in this environment, so nothing was looked up.", toolCalls, cards, stopReason: "stub" };
  }
  const ownerId = options.context.principal.memberId;
  // The admin switches first: a paused agent spends nothing.
  const halted = options.halted ?? (options.client ? async () => false : agentModelHalted);
  if (await halted(ownerId)) return { ok: false, code: "paused", toolCalls };
  const ledger = options.spend ?? databaseLedger();
  if (!(await ledger.allowed(ownerId))) return { ok: false, code: "spend_cap", toolCalls };

  const tools = modelToolsFor(options.context.scope)
    .filter((capability) => options.jobs || !JOB_TOOLS.has(capability.name))
    .map((capability) =>
    betaZodTool({
      name: capability.name,
      description: capability.description,
      inputSchema: capability.input,
      run: async (args) => {
        // A page is read only when the member pasted its link this turn, so
        // nothing the model read elsewhere can send DRVN fetching.
        if (capability.name === "read_part_link" && !linkInMessage((args as { url?: unknown }).url, options.message)) {
          toolCalls.push({ name: capability.name, ok: false, code: "not_allowed" });
          return wrapToolResult(capability.name, { error: "not_allowed", reason: "Only a link the member pasted in this message can be read." });
        }
        try {
          const result = await invokeCapability(capability, { context: options.context, supabase: options.supabase, attachments: (options.images ?? []).map((image) => image.url) }, args);
          toolCalls.push({ name: capability.name, ok: true });
          // The listings a reply leans on become its cards: the one read, or the top of a search.
          if (capability.name === "read_listing" && typeof (args as { listingId?: unknown }).listingId === "string") {
            addCard({ kind: "listing", id: (args as { listingId: string }).listingId });
          }
          if (capability.name === "search_parts" && Array.isArray(result)) {
            for (const row of (result as { id?: unknown }[]).slice(0, 3)) if (typeof row.id === "string") addCard({ kind: "listing", id: row.id });
          }
          if (capability.name === "propose_build_change") {
            const draft = result as z.infer<typeof proposeBuildChange.output>;
            addCard({
              kind: "build_change",
              id: draft.proposalId,
              car: draft.carId,
              replaces: draft.replaces?.id ?? null,
              brand: draft.brand,
              product: draft.product,
              part_number: draft.partNumber,
              category: draft.category,
              product_url: draft.productUrl,
              image_url: draft.imageUrl,
            });
          }
          if (capability.name === "draft_build_list") {
            const draft = result as z.infer<typeof draftBuildList.output>;
            addCard({ kind: "build_list", id: draft.proposalId, car: draft.carId, lines: draft.lines });
          }
          if (capability.name === "browse_marketplace") {
            const found = result as z.infer<typeof browseMarketplace.output>;
            addCard({ kind: "marketplace", id: randomUUID(), query: (args as { query: string }).query.slice(0, 200), href: found.href, count: found.count, capped: found.capped });
          }
          if (capability.name === "draft_listing_from_photos") {
            const draft = result as z.infer<typeof draftListingFromPhotos.output>;
            addCard({ kind: "listing_draft", id: draft.proposalId, title: draft.title, brand: draft.brand, part_number: draft.partNumber, category: draft.category, images: draft.images });
          }
          if (capability.name === "draft_car_update") {
            const draft = result as z.infer<typeof draftCarUpdate.output>;
            addCard({ kind: "update_draft", id: draft.proposalId, car: draft.carId, title: draft.title, body: draft.body, images: draft.images, mods: draft.modIds });
          }
          if (capability.name === "find_parts_to_list") {
            for (const part of (result as z.infer<typeof findPartsToList.output>).slice(0, MAX_CARDS)) addCard({ kind: "list_part", id: part.modId, car: part.carId });
          }
          return wrapToolResult(capability.name, result);
        } catch (error) {
          const code = error instanceof CapabilityError ? error.code : "failed";
          toolCalls.push({ name: capability.name, ok: false, code });
          return wrapToolResult(capability.name, { error: code });
        }
      },
    }),
  );

  // One turn's own bounds: the clock, and its cost so far. Both abort the
  // runner's next request; what was used is recorded in `finally` either way.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
  let inputTokens = 0;
  let outputTokens = 0;
  let overBudget = false;
  try {
    const client = options.client ?? (await anthropicClient());
    const runner = client.beta.messages.toolRunner(
      {
        model: config.model,
        max_tokens: 16000,
        max_iterations: config.maxIterations,
        system: agentSystemPrompt(options.context.scope, Boolean(options.jobs)),
        tools,
        messages: [...redactHistory(options.history ?? []), { role: "user", content: userContent(options.message, options.images) }],
        output_config: { effort: "medium" },
        // A safeguard decline is retried on the model DRVN's account routes it to.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal: controller.signal },
    );
    let last: Anthropic.Beta.BetaMessage | null = null;
    for await (const message of runner) {
      last = message;
      inputTokens += message.usage.input_tokens;
      outputTokens += message.usage.output_tokens;
      const cost = estimateCostUsd(config.model, inputTokens, outputTokens);
      if (cost !== null && cost > TURN_CAP_USD) {
        overBudget = true;
        controller.abort();
        break;
      }
    }
    if (overBudget) {
      reportError("[agent] turn over budget", { taskId: options.taskId ?? null, inputTokens, outputTokens });
      return { ok: false, code: "incomplete", toolCalls };
    }
    if (!last) return { ok: false, code: "model_error", toolCalls };
    if (last.stop_reason === "refusal") {
      reportError("[agent] model refused", { taskId: options.taskId ?? null });
      return { ok: false, code: "refused", toolCalls };
    }
    if (last.stop_reason === "tool_use" || last.stop_reason === "max_tokens" || last.stop_reason === "pause_turn") {
      return { ok: false, code: "incomplete", toolCalls };
    }
    const text = last.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n").trim();
    return { ok: true, text, toolCalls, cards, stopReason: last.stop_reason };
  } catch (error) {
    if (controller.signal.aborted) {
      reportError("[agent] turn timed out", { taskId: options.taskId ?? null, inputTokens, outputTokens });
      return { ok: false, code: "incomplete", toolCalls };
    }
    // Ids and the error's kind only: never the conversation.
    reportError("[agent] model error", { taskId: options.taskId ?? null, kind: error instanceof Error ? error.name : "unknown" });
    return { ok: false, code: "model_error", toolCalls };
  } finally {
    clearTimeout(timer);
    // A turn that failed or was cut short still cost its tokens; the caps count them.
    if (inputTokens + outputTokens > 0) {
      const usage = usageRecord({ model: config.model, inputTokens, outputTokens, taskId: options.taskId ?? null, feature: "agent_chat" });
      logUsage(usage);
      await ledger.record(ownerId, usage);
    }
  }
}
