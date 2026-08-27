import type { ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * The `.alert` notice plate — icon column, bold head, body — previously
 * hand-rolled at 15 sites. Tones follow the Livesheet accent contract:
 * `live` for something needing the reader now, `ok` for confirmation,
 * default for neutral information.
 */
export function Alert({
  tone = "default",
  ico = "●",
  title,
  children,
  className,
  role,
}: {
  tone?: "default" | "live" | "ok";
  /** Single glyph in the icon column. */
  ico?: ReactNode;
  title: ReactNode;
  /** Body copy — rendered inside the `<p>`; links and inline markup welcome. */
  children?: ReactNode;
  className?: string;
  /** Pass "alert" when the notice appears in response to an action. */
  role?: "alert" | "status";
}) {
  return (
    <div
      className={cx(
        "alert",
        tone === "live" && "alert--live",
        tone === "ok" && "alert--ok",
        className,
      )}
      role={role}
    >
      <span className="alert__ico" aria-hidden="true">
        {ico}
      </span>
      <h4>{title}</h4>
      {children && <p>{children}</p>}
    </div>
  );
}
