import type { ReactNode } from "react";

import { Rv } from "@/components/livesheet";
import { cx } from "@/lib/format";

/**
 * KPI tile — microlabel, giant numeral, a `LiveDim` (or any measured line)
 * underneath, optional footer link pinned to the tile floor. The idiom the
 * seller KPI deck and the admin console each re-implemented locally.
 *
 * Lives inside a `.deck.deck--kpi` grid owned by the feature; calculations
 * and data fetching stay with the caller.
 */
export function MetricCard({
  label,
  live = false,
  value,
  valueLive = false,
  blank = false,
  stagger = 0,
  footer,
  className,
  children,
}: {
  label: ReactNode;
  /** Paints the microlabel live — something on this tile needs the reader. */
  live?: boolean;
  /** The giant numeral. Pass "—" (or set `blank`) when there is nothing to count. */
  value: ReactNode;
  /** Paints the numeral itself live (rare — a count demanding action now). */
  valueLive?: boolean;
  /** Dim the numeral (`.num-giant--blank`) — nothing measured yet. */
  blank?: boolean;
  stagger?: number;
  /** Floor-pinned slot — a `jumplink` to the surface being measured. */
  footer?: ReactNode;
  className?: string;
  /** The measured line(s) under the numeral — typically a `LiveDim`. */
  children?: ReactNode;
}) {
  return (
    <Rv className={cx("tile", footer ? "flex flex-col" : undefined, className)} stagger={stagger}>
      <span className={cx("microlabel", live && "microlabel--live")}>{label}</span>
      <p className={cx("num-giant mt-1", blank && "num-giant--blank", valueLive && !blank && "text-live")}>
        {value}
      </p>
      {children}
      {footer}
    </Rv>
  );
}
