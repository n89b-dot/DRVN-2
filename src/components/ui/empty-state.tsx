import type { ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * The `.undrawn` empty-plate recipe — dashed mark badge, drawn-but-empty
 * voice — previously hand-rolled at ~24 sites. Every empty state in the
 * product speaks through this one component so the grammar can't fork.
 *
 * `mark` is the single glyph in the dashed badge ("—", "?", "⏱", an icon).
 * `action` renders after the body — a `ButtonLink` or `jumplink`.
 */
export function EmptyState({
  mark = "—",
  title,
  children,
  action,
  className,
}: {
  mark?: ReactNode;
  title: ReactNode;
  /** Body copy — rendered inside the `<p>`. */
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("undrawn", className)}>
      <span className="undrawn__mark" aria-hidden="true">
        {mark}
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
