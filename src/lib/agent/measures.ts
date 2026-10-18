/**
 * The agent's measures, as agent_compute_metrics (20261024100000) writes
 * them to agent_metrics_daily, with the plain definition shown beside each
 * number on /admin/agent and in docs/site/agent-measures.md. A measure is
 * either a gate (the plan's A3 steps and A5 auto-accept turn on it) or
 * watched. Values come from DRVN's own records, never consented analytics,
 * and any value from fewer than five cases is suppressed (null).
 */

export type MeasureScope = "seller" | "buyer" | "all";
export type MeasureKind = "count" | "share" | "minutes" | "usd" | "position";

export type MeasureDef = {
  scope: MeasureScope;
  measure: string;
  label: string;
  kind: MeasureKind;
  role: "gate" | "watch";
  definition: string;
};

export const AGENT_MEASURES: readonly MeasureDef[] = [
  { scope: "seller", measure: "offers_handled", label: "Offers the seller's agent handled", kind: "count", role: "watch",
    definition: "Offers made that day on a listing with a seller mandate live at the time of the offer." },
  { scope: "seller", measure: "share_without_seller_action", label: "Handled with no seller action", kind: "share", role: "gate",
    definition: "Of those offers, the share where the seller made no counter or decline themselves." },
  { scope: "seller", measure: "agent_deals", label: "Deals the seller's agent reached", kind: "count", role: "watch",
    definition: "Orders created that day from an offer with at least one round made by the seller's agent." },
  { scope: "seller", measure: "agent_deal_cancel_rate", label: "Agent deals cancelled", kind: "share", role: "gate",
    definition: "Of those orders, the share that ended cancelled. Low and steady is the evidence auto-accept (A5) needs." },
  { scope: "seller", measure: "agent_deal_paid_rate", label: "Agent deals that completed payment", kind: "share", role: "gate",
    definition: "Of those orders, the share paid, shipped, delivered or completed." },
  { scope: "seller", measure: "price_position", label: "Where agent deals landed", kind: "position", role: "watch",
    definition: "Average position of the final price between the seller's minimum (0) and asking (1)." },
  { scope: "seller", measure: "approvals", label: "Approvals asked, seller", kind: "count", role: "watch",
    definition: "Times the seller's agent asked its owner to accept, that day." },
  { scope: "seller", measure: "approvals_answered", label: "Approvals answered, seller", kind: "share", role: "watch",
    definition: "Of those, the share the owner accepted or dismissed (not left waiting)." },
  { scope: "seller", measure: "minutes_to_answer", label: "Time to answer, seller", kind: "minutes", role: "watch",
    definition: "Median minutes from the agent asking to the owner answering." },
  { scope: "seller", measure: "turned_off_after_a_move", label: "Turned off within a day of a move", kind: "count", role: "gate",
    definition: "Seller mandates revoked within 24 hours of an agent move: one sign the move wasn't wanted." },
  { scope: "buyer", measure: "negotiations_started", label: "Negotiate for me, started", kind: "count", role: "watch",
    definition: "Buyer mandates created that day." },
  { scope: "buyer", measure: "agent_accepts", label: "Buyer's agent accepted a counter", kind: "count", role: "watch",
    definition: "Counters the buyer's agent accepted within the buyer's max, that day." },
  { scope: "buyer", measure: "approvals", label: "Approvals asked, buyer", kind: "count", role: "watch",
    definition: "Times the buyer's agent asked its owner (a counter over the max)." },
  { scope: "all", measure: "permission_denials", label: "Refused agent writes", kind: "count", role: "gate",
    definition: "Agent writes the database refused (agent_telemetry permission_denied). Should stay at zero." },
  { scope: "all", measure: "approvals_dismissed", label: "Approvals dismissed", kind: "count", role: "watch",
    definition: "Agent proposals the owner dismissed, that day." },
  { scope: "all", measure: "active_members", label: "Members whose agent did something", kind: "count", role: "watch",
    definition: "Members with an agent task that changed that day." },
  { scope: "all", measure: "repeat_share", label: "Returning members", kind: "share", role: "watch",
    definition: "Of those members, the share who had used the agent before that day." },
  { scope: "all", measure: "model_cost_usd", label: "Model cost", kind: "usd", role: "watch",
    definition: "What the model cost that day (agent_usage). Zero until chat (A3c)." },
  { scope: "all", measure: "cost_per_completed_task_usd", label: "Cost per completed task", kind: "usd", role: "watch",
    definition: "That day's model cost divided by agent tasks completed that day." },
];

export function formatMeasure(kind: MeasureKind, value: number | null): string {
  if (value == null) return "—";
  switch (kind) {
    case "share":
      return `${Math.round(value * 100)}%`;
    case "minutes":
      return `${Math.round(value)} min`;
    case "usd":
      return `$${value.toFixed(2)}`;
    case "position":
      return value.toFixed(2);
    default:
      return String(Math.round(value));
  }
}
