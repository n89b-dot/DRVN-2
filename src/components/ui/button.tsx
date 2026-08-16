import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cx } from "@/lib/format";

/**
 * The canonical action component — the `.btn` recipe as a semantic contract.
 *
 * Material's role here is behavioral only: variant = action hierarchy
 * (contained primary / contained default / outlined / text), loading is a
 * defined state rather than a per-page improvisation, and every variant keeps
 * the 44px compact touch floor the stylesheet already enforces. What the
 * button *looks* like — Plex Mono, brackets, ink/live fills, 10px control
 * radius, press scale — is Livesheet's, entirely from `globals.css`.
 *
 * Variant semantics (DRVN decides when):
 * - `default` — an ink-contained action; the workhorse.
 * - `live`    — THE action on a surface. One solid red per surface, never two.
 * - `ghost`   — secondary/outlined; sits beside a contained action.
 * - `destructive` — outlined red; the terminal negative. Never `live` styling.
 * - `quiet`   — the bracketed mono text action (`.relbtn`) for row-level
 *   release/remove actions inside ledgers and lists.
 */
export type ButtonVariant = "default" | "live" | "ghost" | "destructive" | "quiet";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: "btn",
  live: "btn btn--live",
  ghost: "btn btn--ghost",
  destructive: "btn btn--destructive",
  // `!static` because .relbtn positions itself for build-sheet rows; as a
  // standalone action it flows inline.
  quiet: "relbtn !static",
};

/** Pure class resolver — exported so the contract is unit-testable. */
export function buttonClass(variant: ButtonVariant = "default", className?: string) {
  return cx(VARIANT_CLASS[variant], className);
}

type ButtonOwnProps = {
  variant?: ButtonVariant;
  /** Defined loading state: disables the control, sets aria-busy, and swaps
   *  the label to `pendingLabel` so async work is always narrated. */
  loading?: boolean;
  /** Label shown while `loading` — "Saving…", "Sending…". Falls back to the
   *  children so a caller can't render a busy button with no explanation. */
  pendingLabel?: ReactNode;
  /** Layout-only escape hatch (widths, margins). Visual identity stays in the
   *  variant — never pass color/radius/typography utilities here. */
  className?: string;
};

export function Button({
  variant = "default",
  loading = false,
  pendingLabel,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonOwnProps & ComponentPropsWithoutRef<"button">) {
  return (
    <button
      type={type}
      className={buttonClass(variant, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? pendingLabel ?? children : children}
    </button>
  );
}

/** The same action contract rendered as a navigation, for CTAs that are
 *  really links (checkout, browse, release). Keeps `<a>` semantics —
 *  middle-click and new-tab keep working. */
export function ButtonLink({
  variant = "default",
  className,
  children,
  ...rest
}: Omit<ButtonOwnProps, "loading" | "pendingLabel"> &
  ComponentPropsWithoutRef<typeof Link>) {
  return (
    <Link className={buttonClass(variant, className)} {...rest}>
      {children}
    </Link>
  );
}
