import type { ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * The `.tile__head` rule line — ink microlabel on the left, optional trailing
 * slot (a chip, a `jumplink`) on the right. This exact pair was hand-typed at
 * 60+ call sites; the tile itself stays plain `.tile` markup because a
 * wrapper div adds no contract.
 */
export function TileHead({
  label,
  end,
  className,
}: {
  label: ReactNode;
  /** Trailing slot — a count chip, a "View all →" jumplink. */
  end?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("tile__head", className)}>
      <span className="microlabel microlabel--ink">{label}</span>
      {end}
    </div>
  );
}
