import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * The selection/filtering family — the `.filters` + `.fbtn` recipes as
 * semantic components, so no page decides for itself whether a filter row
 * wraps, scrolls, or stacks.
 *
 * Material's chip/segmented model supplies the behavioral contract: an axis
 * of related refinements is one labelled group; single-select uses
 * `aria-current` (link mode) or `aria-pressed` (button mode); every target
 * keeps the 44px floor the stylesheet bakes into `.fbtn` at every width.
 * The look — mono microcaps, ink-inverted selection, 6px chip geometry,
 * gutter-bleed compact scrolling — is Livesheet's.
 *
 * Axis grammar (already in the CSS, now named):
 * - default        — a plain wrapping row (tab-like registers).
 * - `stack`        — the primary axis, on its own line.
 * - `sub`          — a quieter secondary axis beneath a primary one.
 * - `scroll`       — compact widths scroll sideways in the page gutter
 *                    instead of wrapping; pair with `sub` for dense axes.
 * - `fit`          — a short, fixed set of segments (Explore's five) that
 *                    must all be visible on a phone: below 640px they share
 *                    the row in equal columns, icon over word, and the
 *                    leading label steps aside. Never a sideways scroll.
 *
 * A scrolling row also drops its leading label below 640px — on a phone the
 * label cost ~100px and pushed real choices off-screen.
 */
export function FilterGroup({
  label,
  ariaLabel,
  stack = false,
  sub = false,
  scroll = false,
  fit = false,
  className,
  children,
}: {
  /** Visible mono introduction for the axis ("Read state", "Sort"). */
  label?: ReactNode;
  /** Accessible name for the group; falls back to `label` when it's a string. */
  ariaLabel?: string;
  stack?: boolean;
  sub?: boolean;
  scroll?: boolean;
  fit?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "filters",
        stack && "filters--stack",
        sub && "filters--sub",
        scroll && "filters--scroll",
        fit && "filters--fit",
        className
      )}
      role="group"
      aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
    >
      {label && <span className="microlabel filters__label">{label}</span>}
      {children}
    </div>
  );
}

/** Optional count suffix on a filter target — `live` paints it in signal red. */
function Count({ count, live }: { count?: number | null; live?: boolean }) {
  if (count == null || count <= 0) return null;
  return <span className={live ? "n n--live" : "n"}>{count}</span>;
}

/**
 * Link-mode filter chip — for server-rendered, URL-backed refinement (the
 * DRVN default: every filter state is a shareable address).
 */
export function FilterLink({
  selected = false,
  count,
  live,
  className,
  children,
  ...rest
}: {
  selected?: boolean;
  count?: number | null;
  live?: boolean;
  className?: string;
  children: ReactNode;
} & ComponentPropsWithoutRef<typeof Link>) {
  return (
    <Link
      className={cx("fbtn", selected && "is-on", className)}
      aria-current={selected ? "true" : undefined}
      {...rest}
    >
      {children}
      <Count count={count} live={live} />
    </Link>
  );
}

/**
 * Button-mode filter chip — for client-state toggles. `aria-pressed` drives
 * the live-fill selected treatment in the stylesheet, so state and styling
 * cannot drift apart.
 */
export function FilterButton({
  pressed = false,
  count,
  live,
  className,
  children,
  type = "button",
  ...rest
}: {
  pressed?: boolean;
  count?: number | null;
  live?: boolean;
  className?: string;
  children: ReactNode;
} & ComponentPropsWithoutRef<"button">) {
  return (
    <button
      type={type}
      className={cx("fbtn", className)}
      aria-pressed={pressed}
      {...rest}
    >
      {children}
      <Count count={count} live={live} />
    </button>
  );
}

/**
 * An applied filter as a removable chip (`.chip--x`) — clicking it clears
 * that dimension. Used by the marketplace's active-filter row.
 */
export function ActiveFilterChip({
  href,
  children,
  label,
}: {
  href: string;
  children: ReactNode;
  /** Accessible action name, e.g. "Clear condition filter". */
  label: string;
}) {
  return (
    <Link href={href} className="chip chip--x" aria-label={label}>
      {children}
      <span aria-hidden="true">✕</span>
    </Link>
  );
}
