import type { ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * The `.bline` ruled baseline row — mono label column, value column, optional
 * note — the read-only/settings sibling of the form `.field`.
 *
 * Two shapes, one component:
 * - value row: pass `value` — renders a `<div>` with `.bline__val`.
 * - control row: pass `children` (an input/select with `.ctl`) — renders a
 *   `<label>` with `.bline--ctl` so the label column is the control's label.
 *
 * Previously forked as route-local `CtlLine`/`ReadOnlyLine` in Settings and
 * a bespoke `bline--own` row on the car sheet.
 */
export function DataRow({
  label,
  value,
  note,
  className,
  children,
}: {
  label: ReactNode;
  /** Read-only value (`.bline__val`). Ignored when `children` is passed. */
  value?: ReactNode;
  /** Dim trailing note (`.bline__note`). */
  note?: ReactNode;
  className?: string;
  /** A control (`.ctl` input/select) — switches to the labelled control row. */
  children?: ReactNode;
}) {
  if (children) {
    return (
      <label className={cx("bline bline--ctl", className)}>
        <span className="bline__label">{label}</span>
        {children}
        {note && <span className="bline__note">{note}</span>}
      </label>
    );
  }
  return (
    <div className={cx("bline", className)}>
      <span className="bline__label">{label}</span>
      <span className="bline__val !text-body">{value}</span>
      {note && <span className="bline__note">{note}</span>}
    </div>
  );
}
