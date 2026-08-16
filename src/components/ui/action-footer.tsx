import type { ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * The commit row of an editing surface — the `.saverow` recipe as a
 * component: aux action anchored left, status and the primary action on the
 * right; compact widths stack the three deliberately (aux, then status as a
 * line of its own, then a full-width 44px commit) instead of letting flex
 * wrap decide.
 *
 * Status is part of the contract, not a per-page improvisation: `ok` renders
 * the confirmation chip (`role="status"`), `error` the live error line
 * (`role="alert"`).
 */
export function ActionFooter({
  aux,
  status,
  className,
  children,
}: {
  /** Left-anchored quiet action ("+ Add a line manually"). */
  aux?: ReactNode;
  status?: { kind: "ok" | "error"; message: string } | null;
  className?: string;
  /** The commit action(s) — a Button, usually variant="live". */
  children: ReactNode;
}) {
  return (
    <div className={cx("saverow", className)}>
      {aux && <span className="saverow__aux flex items-center">{aux}</span>}
      {status &&
        (status.kind === "ok" ? (
          <span role="status" className="chip chip--ok saverow__status">
            {status.message}
          </span>
        ) : (
          <span role="alert" className="field__err saverow__status">
            {status.message}
          </span>
        ))}
      {children}
    </div>
  );
}
