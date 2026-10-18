/**
 * Who the agent acts for (docs/decisions/agent-foundations.md §1). Every
 * agent action carries one context: a principal, a scope and permissions.
 *
 * - The principal is a member today. Its id comes from the session, or for
 *   the offline worker from a leased job → task → mandate in the database —
 *   never from a request argument and never from model output.
 * - The scope is internal ("seller", "buyer", "garage"); the member sees one
 *   agent (AG-1).
 * - Permissions say how far this principal may go in this scope right now:
 *   the highest risk level, the tools allowed, and the mandate behind them.
 *   The database re-checks all of it on every write; this is the app's view.
 */

export type AgentScope = "seller" | "buyer" | "garage";

/** R0 read · R1 draft · R2 write own content · R3 set limits · R4 money. */
export type Risk = "R0" | "R1" | "R2" | "R3" | "R4";

export const RISK_ORDER: readonly Risk[] = ["R0", "R1", "R2", "R3", "R4"];

export type Principal =
  | { kind: "member"; memberId: string };

export type AgentPermissions = {
  /** The highest risk this context may run. The model never gets above R1. */
  maxRisk: Risk;
  /** The mandate behind a negotiation, when there is one. */
  mandate?: { id: string; version: number };
  /** A kill switch in force, when the caller already knows one is. */
  halted?: string | null;
};

export type AgentContext = {
  principal: Principal;
  scope: AgentScope;
  permissions: AgentPermissions;
};

export function riskAtMost(risk: Risk, ceiling: Risk): boolean {
  return RISK_ORDER.indexOf(risk) <= RISK_ORDER.indexOf(ceiling);
}

/** The context for a signed-in member acting through the app themselves. */
export function memberContext(memberId: string, scope: AgentScope, permissions: Partial<AgentPermissions> = {}): AgentContext {
  if (!memberId) throw new Error("A member is required");
  return { principal: { kind: "member", memberId }, scope, permissions: { maxRisk: "R4", ...permissions } };
}

/** The context the model works in: reads and drafts only (AG-5). */
export function modelContext(memberId: string, scope: AgentScope): AgentContext {
  return memberContext(memberId, scope, { maxRisk: "R1" });
}
