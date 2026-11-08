/**
 * The agent's measures, as agent_compute_metrics (20261024100000) writes
 * them to agent_metrics_daily, with the plain definition shown beside each
 * number on /admin/agent and in docs/site/agent-measures.md. A measure is
 * either a gate (the plan's A3 steps and A5 auto-accept turn on it) or
 * watched. Values come from DRVN's own records, never consented analytics,
 * and any value from fewer than five cases is suppressed (null).
 *
 * Neil's ruling (R-usage, R-measures, 7 Nov 2026): compute what the records
 * support, label approximations precisely, and mark the rest unavailable.
 * So every measure has a basis, and every reading has a typed status that
 * tells an unavailable measure, a missing computation, too few cases and a
 * measured zero apart. None of them is ever shown as a number it isn't.
 */

export type MeasureScope = "seller" | "buyer" | "all";
export type MeasureKind = "count" | "share" | "minutes" | "usd" | "position";

/** Values from fewer cases than this are suppressed (stored as null). */
export const MEASURE_MIN_SAMPLE = 5;

/**
 * Where a measure's number comes from.
 * - `computed`: agent_compute_metrics computes it from the records as defined.
 * - `approximation`: computed, but from records that only approximate the
 *   definition; `note` says exactly how.
 * - `unavailable_instrumentation`: the records it needs aren't kept.
 * - `missing_computation`: the records exist but nothing computes it yet.
 */
export type MeasureBasis =
  | { kind: "computed" }
  | { kind: "approximation"; note: string }
  | { kind: "unavailable_instrumentation"; reason: string }
  | { kind: "missing_computation"; reason: string };

export type MeasureDef = {
  scope: MeasureScope;
  measure: string;
  label: string;
  kind: MeasureKind;
  role: "gate" | "watch";
  definition: string;
  basis: MeasureBasis;
  /** A total (a count or a sum): no cases means a measured zero, not too few cases. */
  total?: true;
  /** The SQL groups this measure by scope, so a day with no cases writes no row. */
  rowOnlyWithCases?: true;
};

const COMPUTED: MeasureBasis = { kind: "computed" };

/** Each day is recomputed on that day's passes and the next day's, then left alone. */
const LAST_RECOMPUTE = "the day's last recompute (by the end of the next UTC day)";

const NO_MANUAL_BASELINE =
  "No manual-listing baseline. The beta runs no comparison cohort, and a listing keeps only its current price, so the same-subcategory, same-price-band match at the time of an offer can't be rebuilt from the records.";

export const AGENT_MEASURES: readonly MeasureDef[] = [
  { scope: "seller", measure: "paid_sales_vs_manual", label: "Headline: paid sales vs comparable manual listings", kind: "share", role: "gate",
    definition: "Paid, completed sales from agent-handled listings against comparable manual listings (same subcategory and price band, same period, at least one offer).",
    basis: { kind: "unavailable_instrumentation", reason: NO_MANUAL_BASELINE } },
  { scope: "seller", measure: "agent_vs_manual_conversion", label: "Agent vs manual seller conversion", kind: "share", role: "watch",
    definition: "The share of offers that became paid orders, agent-handled listings against comparable manual ones.",
    basis: { kind: "unavailable_instrumentation", reason: NO_MANUAL_BASELINE } },
  { scope: "seller", measure: "offers_handled", label: "Offers the seller's agent handled", kind: "count", role: "watch", total: true,
    definition: "Offers made that day on a listing with a seller mandate live at the time of the offer.",
    basis: COMPUTED },
  { scope: "seller", measure: "share_without_seller_action", label: "Handled with no seller action", kind: "share", role: "gate",
    definition: "Of those offers, the share where the seller made no counter or decline themselves.",
    basis: { kind: "approximation", note: `Counts the seller's own counters and declines made by ${LAST_RECOMPUTE}; a seller who steps in later isn't seen.` } },
  { scope: "seller", measure: "agent_deals", label: "Deals the seller's agent reached", kind: "count", role: "watch", total: true,
    definition: "Orders created that day from an offer with at least one round made by the seller's agent.",
    basis: COMPUTED },
  { scope: "seller", measure: "agent_deal_cancel_rate", label: "Agent deals cancelled", kind: "share", role: "gate",
    definition: "Of those orders, the share that ended cancelled. Low and steady is the evidence auto-accept (A5) needs.",
    basis: { kind: "approximation", note: `The order's status as of ${LAST_RECOMPUTE}, not its final outcome: a later cancellation isn't counted.` } },
  { scope: "seller", measure: "agent_deal_paid_rate", label: "Agent deals that completed payment", kind: "share", role: "gate",
    definition: "Of those orders, the share paid, shipped, delivered or completed.",
    basis: { kind: "approximation", note: `The order's status as of ${LAST_RECOMPUTE}, not its final outcome: a later payment or cancellation isn't counted.` } },
  { scope: "seller", measure: "price_position", label: "Where agent deals landed", kind: "position", role: "watch",
    definition: "Average position of the final price between the seller's minimum (0) and asking (1).",
    basis: { kind: "approximation", note: "Uses the listing's current asking price and the seller's latest mandate minimum, not the asking price and minimum when the deal was made." } },
  { scope: "seller", measure: "agent_net_sales_usd", label: "Agent deal value net of cancellations and refunds", kind: "usd", role: "watch",
    definition: "The value of agent-reached orders less cancellations and refunds.",
    basis: { kind: "missing_computation", reason: "Orders and refunds hold it, but nothing computes it yet: the plan keeps amounts only as aggregate bands, and no band scheme is defined." } },
  { scope: "seller", measure: "approvals", label: "Approvals asked, seller", kind: "count", role: "watch", total: true, rowOnlyWithCases: true,
    definition: "Times the seller's agent asked its owner to accept, that day.",
    basis: COMPUTED },
  { scope: "seller", measure: "approvals_answered", label: "Approvals answered, seller", kind: "share", role: "watch", rowOnlyWithCases: true,
    definition: "Of those, the share the owner accepted or dismissed (not left waiting).",
    basis: { kind: "approximation", note: `Answers given by ${LAST_RECOMPUTE}; a later answer still counts as waiting.` } },
  { scope: "seller", measure: "minutes_to_answer", label: "Time to answer, seller", kind: "minutes", role: "watch", rowOnlyWithCases: true,
    definition: "Median minutes from the agent asking to the owner answering.",
    basis: { kind: "approximation", note: `Only approvals answered by ${LAST_RECOMPUTE}, so the slowest answers are left out and the median runs low.` } },
  { scope: "seller", measure: "turned_off_after_a_move", label: "Turned off within a day of a move", kind: "count", role: "gate", total: true,
    definition: "Seller mandates revoked within 24 hours of an agent move: one sign the move wasn't wanted.",
    basis: COMPUTED },
  { scope: "seller", measure: "minutes_to_deal", label: "Time to deal", kind: "minutes", role: "watch",
    definition: "Median minutes from an offer to the order an agent deal made from it.",
    basis: { kind: "missing_computation", reason: "Offer and order times hold it, but nothing computes it yet." } },
  { scope: "buyer", measure: "negotiations_started", label: "Negotiate for me, started", kind: "count", role: "watch", total: true,
    definition: "Buyer mandates created that day.",
    basis: COMPUTED },
  { scope: "buyer", measure: "agent_accepts", label: "Buyer's agent accepted a counter", kind: "count", role: "watch", total: true,
    definition: "Counters the buyer's agent accepted within the buyer's max, that day.",
    basis: COMPUTED },
  { scope: "buyer", measure: "approvals", label: "Approvals asked, buyer", kind: "count", role: "watch", total: true, rowOnlyWithCases: true,
    definition: "Times the buyer's agent asked its owner (a counter over the max).",
    basis: COMPUTED },
  { scope: "all", measure: "permission_denials", label: "Refused agent writes", kind: "count", role: "gate", total: true,
    definition: "Agent writes the database refused (agent_telemetry permission_denied). Should stay at zero.",
    basis: COMPUTED },
  { scope: "all", measure: "approvals_dismissed", label: "Approvals dismissed", kind: "count", role: "watch", total: true,
    definition: "Agent proposals the owner dismissed, that day.",
    basis: COMPUTED },
  { scope: "all", measure: "reports_on_agent_rounds", label: "Buyer reports naming an agent round", kind: "count", role: "gate",
    definition: "Reports from buyers about a move the agent made in a negotiation.",
    basis: { kind: "unavailable_instrumentation", reason: "A report names a listing, member, post or comment, never an offer round, so a report about an agent's move can't be told apart." } },
  { scope: "all", measure: "incorrect_action_rate", label: "Incorrect-action rate", kind: "share", role: "watch",
    definition: "Agent moves followed by a sign the move was wrong, over all agent moves.",
    basis: { kind: "missing_computation", reason: "Its signals are counted one by one above; nothing combines them into a rate over agent moves yet." } },
  { scope: "all", measure: "active_members", label: "Members whose agent did something", kind: "count", role: "watch", total: true,
    definition: "Members with an agent task that changed that day.",
    basis: { kind: "approximation", note: "Reads agent_tasks.updated_at, which every later change overwrites: a member whose task changed that day and again later counts only on the later day." } },
  { scope: "all", measure: "repeat_share", label: "Returning members", kind: "share", role: "watch",
    definition: "Of those members, the share who had used the agent before that day.",
    basis: { kind: "approximation", note: "Its members come from agent_tasks.updated_at, which every later change overwrites, so a day's members can drop out when their task changes again; 'before' means a task created before that day." } },
  { scope: "all", measure: "time_to_first_useful_task", label: "Time to first useful agent task", kind: "minutes", role: "watch",
    definition: "Time from a member first turning the agent on to its first task that did something useful for them.",
    basis: { kind: "missing_computation", reason: "No rule yet says which task outcome counts as useful, so nothing computes it." } },
  { scope: "all", measure: "model_cost_usd", label: "Model cost", kind: "usd", role: "watch", total: true,
    definition: "What metered model calls cost that day (agent_usage: agent chat, Marketplace sentence filters, listing import and evals).",
    basis: { kind: "approximation", note: "A lower bound: a call on a model with no price recorded stores no cost and adds $0." } },
  { scope: "all", measure: "cost_per_completed_task_usd", label: "Daily model cost ÷ tasks completed", kind: "usd", role: "watch",
    definition: "That day's model cost divided by the agent tasks completed that day.",
    basis: { kind: "approximation", note: "Not a per-task cost. The cost is mostly chat, which records no task, while completed tasks are negotiation tasks: this is one day's total divided by another count." } },
  { scope: "all", measure: "cost_per_task_usd", label: "Model cost per completed task", kind: "usd", role: "watch",
    definition: "The model cost of each completed task, averaged.",
    basis: { kind: "unavailable_instrumentation", reason: "Chat turns record no task (agent_usage.task_id is empty for chat), so model cost can't be tied to the task it served." } },
];

/** One stored daily row (agent_metrics_daily). */
export type MeasureRow = { value: number | null; sample: number };

/** What one measure says for one day. Only `measured` carries a number. */
export type MeasureReading =
  | { status: "measured"; value: number; sample: number }
  | { status: "measured_zero"; sample: number }
  | { status: "insufficient_sample"; sample: number }
  | { status: "unavailable_instrumentation"; reason: string }
  | { status: "missing_computation"; reason: string };

export type MeasureStatus = MeasureReading["status"];

/**
 * Reads one measure for one day.
 * `dayComputed` is whether agent_compute_metrics wrote anything for that day
 * (every pass writes the ungrouped measures, so any row means it ran).
 */
export function readMeasure(def: MeasureDef, row: MeasureRow | undefined, dayComputed: boolean): MeasureReading {
  if (def.basis.kind === "unavailable_instrumentation") return { status: "unavailable_instrumentation", reason: def.basis.reason };
  if (def.basis.kind === "missing_computation") return { status: "missing_computation", reason: def.basis.reason };
  if (!dayComputed) return { status: "missing_computation", reason: "The agent job hasn't computed this day (agent_compute_metrics)." };

  const stored = row ?? (def.rowOnlyWithCases ? { value: null, sample: 0 } : undefined);
  if (!stored) return { status: "missing_computation", reason: "The day was computed but this measure wrote no row." };

  const sample = Number.isFinite(stored.sample) ? Math.max(0, Math.trunc(stored.sample)) : 0;
  if (sample === 0) {
    return def.total ? { status: "measured_zero", sample: 0 } : { status: "insufficient_sample", sample: 0 };
  }
  if (sample < MEASURE_MIN_SAMPLE) return { status: "insufficient_sample", sample };

  const value = stored.value == null ? null : Number(stored.value);
  if (value == null || !Number.isFinite(value)) {
    return { status: "missing_computation", reason: "The day had enough cases but the measure stored no value." };
  }
  return value === 0 ? { status: "measured_zero", sample } : { status: "measured", value, sample };
}

/** The approximation note, or null when the measure is exact or not computed. */
export function approximationNote(def: MeasureDef): string | null {
  return def.basis.kind === "approximation" ? def.basis.note : null;
}

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

export const STATUS_TEXT: Record<Exclude<MeasureStatus, "measured" | "measured_zero">, string> = {
  insufficient_sample: `Under ${MEASURE_MIN_SAMPLE}`,
  unavailable_instrumentation: "Unavailable",
  missing_computation: "Not computed",
};

/** The cell text: a number only when one was measured, else what the status is. */
export function formatReading(def: MeasureDef, reading: MeasureReading): string {
  switch (reading.status) {
    case "measured":
      return formatMeasure(def.kind, reading.value);
    case "measured_zero":
      return formatMeasure(def.kind, 0);
    default:
      return STATUS_TEXT[reading.status];
  }
}

/** The hover text for a cell: why it shows what it shows. */
export function explainReading(reading: MeasureReading): string {
  switch (reading.status) {
    case "measured":
      return `Measured from ${reading.sample} cases.`;
    case "measured_zero":
      return reading.sample ? `Measured zero, from ${reading.sample} cases.` : "Measured zero: no cases that day.";
    case "insufficient_sample":
      return reading.sample
        ? `Fewer than ${MEASURE_MIN_SAMPLE} cases, so the value is suppressed.`
        : "No cases that day, so there is nothing to measure.";
    default:
      return reading.reason;
  }
}
