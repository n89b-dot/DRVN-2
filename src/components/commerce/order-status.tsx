import type { OrderStatus } from "@/lib/database.types";

/**
 * Order/offer lifecycle presentation — shared by Orders, Offers and the
 * seller ledger. Moved out of the Orders route: a status chip used by three
 * surfaces is a commerce domain pattern, not an Orders implementation detail.
 */

/**
 * The order lifecycle as a pipeline. Uses `.pipe`, which shipped in the
 * Livesheet stylesheet and had no call site — the product previously showed a
 * single status chip and nothing about where an order actually was.
 */
const STAGES: { key: string; label: string; reached: OrderStatus[] }[] = [
  { key: "placed", label: "Placed", reached: ["pending", "requires_action", "paid", "shipped", "delivered", "completed", "refunded", "disputed"] },
  { key: "paid", label: "Paid", reached: ["paid", "shipped", "delivered", "completed", "refunded", "disputed"] },
  { key: "shipped", label: "Dispatched", reached: ["shipped", "delivered", "completed"] },
  { key: "delivered", label: "Delivered", reached: ["delivered", "completed"] },
];

const TERMINAL: Partial<Record<OrderStatus, string>> = {
  cancelled: "Cancelled",
  payment_failed: "Payment failed",
  refunded: "Refunded",
  disputed: "In dispute",
};

export function OrderPipeline({
  status,
  progressStatus,
}: {
  status: OrderStatus;
  /**
   * The furthest ordinary stage the order actually reached before it was
   * disputed or refunded — `orders.pre_dispute_status` (migration 0014, NOT
   * applied). Without this, a disputed order that had already shipped and
   * been delivered rendered as stuck at "Paid", because `disputed`/`refunded`
   * only appear in the placed/paid stages below. A pre-dispatch refund has no
   * such stage to fall back to, so it correctly still reads as stuck at paid.
   */
  progressStatus?: OrderStatus | null;
}) {
  const terminal = TERMINAL[status];

  if (terminal && status !== "refunded" && status !== "disputed") {
    return (
      <span className="pipe">
        <span className="pip" />
        <span className="lbl">{terminal}</span>
      </span>
    );
  }

  const effective = progressStatus ?? status;
  const currentIndex = STAGES.reduce(
    (last, stage, index) => (stage.reached.includes(effective) ? index : last),
    -1
  );

  return (
    <span className="pipe" role="img" aria-label={`Order status: ${terminal ?? STAGES[currentIndex]?.label ?? "placed"}`}>
      {STAGES.map((stage, index) => (
        <span key={stage.key} className={`pip ${index <= currentIndex ? "is-on" : ""}`} />
      ))}
      <span className="lbl">{terminal ?? STAGES[currentIndex]?.label ?? "Placed"}</span>
    </span>
  );
}

/** Chip tone for an order/offer lifecycle state — ok, live, or spent. */
export function statusChipClass(status: string) {
  if (["paid", "delivered", "completed", "accepted"].includes(status)) return "chip chip--ok";
  if (["pending", "open", "countered", "shipped", "requires_action"].includes(status)) {
    return "chip chip--live";
  }
  return "chip chip--spent";
}

/** Order/offer status as a toned chip. */
export function StatusChip({ status }: { status: string }) {
  return <span className={statusChipClass(status)}>{status.replace(/_/g, " ")}</span>;
}
