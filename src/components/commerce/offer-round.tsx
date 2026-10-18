import type { ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * One move in an offer's history (A3 design 04): who acted, the amount and
 * when, a muted "· via agent" on an agent's turn, and — only on the viewer's
 * own agent's turns — the one line saying why. Stacked on phones; from 640px
 * who-and-why sits left and the amount line right. Goes inside a `.rowlist`.
 */
export function OfferRound({
  who,
  amount,
  when,
  viaAgent = false,
  reason,
  className,
}: {
  who: ReactNode;
  /** Formatted amount, when the move named one. */
  amount?: ReactNode;
  /** Formatted time of the move. */
  when: ReactNode;
  viaAgent?: boolean;
  /** Why the viewer's own agent did it. Never pass one for the other side. */
  reason?: ReactNode;
  className?: string;
}) {
  return (
    <li className={cx("jobrow oround", className)}>
      <span className="oround__who">{who}</span>
      <span className="oround__meta">
        {amount != null && <>{amount} · </>}
        {when}
        {viaAgent && <span className="viaagent"> · via agent</span>}
      </span>
      {reason && <span className="oround__why">{reason}</span>}
    </li>
  );
}
