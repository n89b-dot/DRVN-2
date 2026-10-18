/** The kill switches, in the words an operator uses (docs/production-runbook.md §13b). */
export type AgentSwitchScope = "all" | "buyer" | "seller" | "member" | "mandate" | "listing" | "account";

export const AGENT_SWITCH_SCOPES: { scope: AgentSwitchScope; label: string; stops: string }[] = [
  { scope: "all", label: "Every agent", stops: "Every agent write, both sides." },
  { scope: "seller", label: "Seller side", stops: "Every seller's agent." },
  { scope: "buyer", label: "Buyer side", stops: "Every buyer's agent." },
  { scope: "member", label: "One member's agent", stops: "Everything that member's agent does." },
  { scope: "mandate", label: "One mandate", stops: "The agent on that one listing's limits." },
  { scope: "listing", label: "One listing", stops: "Every agent on that listing, either side." },
  { scope: "account", label: "One account", stops: "Every agent acting for or against that member." },
];

export function switchLabel(scope: string) {
  return AGENT_SWITCH_SCOPES.find((item) => item.scope === scope)?.label ?? scope;
}
