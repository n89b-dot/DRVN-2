import type { ReactNode } from "react";

import { Rv } from "@/components/livesheet";
import { cx } from "@/lib/format";

/**
 * The `.pagehead` recipe as a contract — mono eyebrow, display h1, optional
 * sub line — previously hand-assembled as `<Rv as="header" className="pagehead">`
 * on 40+ pages. Extra rows (actions, `.pagehead__row`) go in `children`.
 *
 * Headings are visible in server HTML. Opt into reveal only for secondary UI.
 */
export function PageHead({
  eyebrow,
  title,
  sub,
  reveal = false,
  className,
  children,
}: {
  /** Mono microlabel line above the title. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Dim supporting line under the title (`.sub`). */
  sub?: ReactNode;
  reveal?: boolean;
  /** Variant/spacing hooks — e.g. `pagehead--task`, `!pb-4`. */
  className?: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      {eyebrow && <span className="microlabel">{eyebrow}</span>}
      <h1>{title}</h1>
      {sub && <p className="sub">{sub}</p>}
      {children}
    </>
  );

  if (!reveal) {
    return <header className={cx("pagehead", className)}>{body}</header>;
  }
  return (
    <Rv as="header" className={cx("pagehead", className)}>
      {body}
    </Rv>
  );
}
