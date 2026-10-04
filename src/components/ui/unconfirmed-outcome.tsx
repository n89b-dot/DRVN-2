"use client";

import type { ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * A mutation whose outcome is unknown: the Server Action's response was lost
 * (a dropped connection, a restarted server), so the change may or may not
 * have landed. It takes the place of the action that was tried rather than
 * sitting beside it — for money or destructive work, offering the same
 * button again invites a duplicate. Reloading reads the real state.
 */
export function UnconfirmedOutcome({
  children,
  className,
}: {
  /** What couldn't be confirmed, in the action's own words. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" aria-live="polite" className={cx("grid justify-items-start gap-1", className)}>
      <p className="field__err">{children}</p>
      <button type="button" className="jumplink" onClick={() => window.location.reload()}>
        Reload to check →
      </button>
    </div>
  );
}
