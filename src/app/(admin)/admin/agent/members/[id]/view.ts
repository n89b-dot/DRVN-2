import { formatPrice } from "@/lib/marketplace/taxonomy";

/**
 * How one member's agent reads on /admin/agent/members/[id] (readiness
 * report two, 70). A seller's minimum and target, a buyer's ceiling, and
 * every amount derived from them (the agent's counters, which can sit on the
 * minimum, and the offers it asked its owner about) are shown only when
 * `showAmounts` is true: a full admin, after the view's audit row is
 * written. A viewer gets the states, styles and versions.
 */
export type MandateView = {
  scope: string;
  style: string;
  minimum_cents: number | null;
  target_cents: number | null;
  ceiling_cents: number | null;
  ceiling_basis: string | null;
};

export function limitsLine(m: MandateView, showAmounts: boolean): string {
  if (!showAmounts) return `${m.style} · amounts shown to full admins only`;
  return m.scope === "seller"
    ? `minimum ${m.minimum_cents != null ? formatPrice(m.minimum_cents) : "the listing's"} · target ${m.target_cents != null ? formatPrice(m.target_cents) : "asking"} · ${m.style}`
    : `max ${m.ceiling_cents != null ? formatPrice(m.ceiling_cents) : "—"} on ${m.ceiling_basis === "total" ? "item + shipping" : "the item"} · ${m.style}`;
}

export function eventLine(e: { kind: string; inputs: unknown; result: unknown }, showAmounts: boolean): string {
  const inputs = (e.inputs ?? {}) as Record<string, unknown>;
  const result = (e.result ?? {}) as Record<string, unknown>;
  if (e.kind === "move") return `${String(inputs.kind ?? "move")}${showAmounts && typeof inputs.amount_cents === "number" ? ` ${formatPrice(inputs.amount_cents)}` : ""}`;
  if (e.kind === "decision") return `held: ${String(result.reason ?? result.decision ?? "")}`;
  if (e.kind === "approval") return `owner ${String(result.choice ?? "answered")}`;
  return e.kind;
}

export function approvalTitle(a: { reason: string | null; amount_cents: number | null }, showAmounts: boolean): string {
  const amount = !showAmounts ? "amount shown to full admins only" : a.amount_cents != null ? formatPrice(a.amount_cents) : "—";
  return `${a.reason ?? "approval"} · ${amount}`;
}
