/**
 * AG-7: the member-level agent setting — Off · Suggest · Act within my limits
 * (profiles.agent_mode, 20261107170000). Pure: types and copy only, so client
 * components can say why an entry point is disabled. The read is
 * `loadAgentMode` in member-mode.ts (server-only).
 *
 * - off: nothing. The entry points (Ask your agent, Negotiate for me, Let DRVN
 *   handle offers) render disabled, and the actions refuse.
 * - suggest: price-drop suggestions and the chat work; no mandate can be
 *   started, so the agent never negotiates or moves money.
 * - act: today's behaviour.
 *
 * The worker needs no change: it acts only on a live mandate, which can't be
 * started outside 'act', and saving a lower mode ends the live ones.
 */

export type AgentMode = "off" | "suggest" | "act";

export const AGENT_MODES: readonly AgentMode[] = ["off", "suggest", "act"];

export const DEFAULT_AGENT_MODE: AgentMode = "act";

export function isAgentMode(value: unknown): value is AgentMode {
  return typeof value === "string" && (AGENT_MODES as readonly string[]).includes(value);
}

export const AGENT_MODE_LABEL: Record<AgentMode, string> = {
  off: "Off",
  suggest: "Suggest",
  act: "Act within my limits",
};

export const AGENT_MODE_HINT: Record<AgentMode, string> = {
  off: "Your agent does nothing. Ask your agent, Negotiate for me and Let DRVN handle offers are switched off.",
  suggest: "Your agent answers questions and suggests prices, but never negotiates or moves money for you.",
  act: "Your agent negotiates offers within limits you set on each listing, and asks you before anything else.",
};

/** May a mandate (seller or buyer) be started under this mode? */
export function agentModeAllowsMandates(mode: AgentMode): boolean {
  return mode === "act";
}

/** May the chat and the price-drop suggestions run under this mode? */
export function agentModeAllowsChat(mode: AgentMode): boolean {
  return mode !== "off";
}

/**
 * What a disabled entry point says, and what the action returns when it
 * refuses. One short line, naming where to change it.
 */
export function agentModeRefusal(mode: AgentMode): string | null {
  switch (mode) {
    case "off":
      return "Agent is off in Settings.";
    case "suggest":
      return "Agent is set to Suggest in Settings, so it can't negotiate for you.";
    default:
      return null;
  }
}
