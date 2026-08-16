import type { ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * Persistent compact-screen action bar — the `.buybar` recipe as a
 * component. Fixed to the bottom with safe-area padding; the stylesheet
 * reserves matching body clearance (`body:has(.buybar…)`) so the page's last
 * content stays reachable, and retires the bar exactly where the page's real
 * controls regain a column (981px plain, 1024px `wide`).
 *
 * For the highest-value action on a transaction surface only — cart
 * checkout, PDP buy. Not a general sticky-toolbar primitive.
 */
export function MobileActionBar({
  label,
  totalLabel = "Total",
  total,
  ship,
  wide = false,
  className,
  children,
}: {
  /** Accessible name for the bar region ("Checkout"). */
  label: string;
  totalLabel?: string;
  /** Formatted amount shown large in the total block. */
  total: ReactNode;
  /** Optional second line under the amount (shipping note). */
  ship?: ReactNode;
  /** `wide` keeps the bar through tablet widths (to 1024px) for pages whose
   *  side column only returns at `lg` — cart, checkout. */
  wide?: boolean;
  className?: string;
  /** The action — a ButtonLink or Button, usually variant="live". */
  children: ReactNode;
}) {
  return (
    <div className={cx("buybar", wide && "buybar--wide", className)} aria-label={label}>
      <span className="buybar__total">
        <span className="microlabel">{totalLabel}</span>
        <span className="buybar__price">{total}</span>
        {ship && <span className="buybar__ship">{ship}</span>}
      </span>
      {children}
    </div>
  );
}
