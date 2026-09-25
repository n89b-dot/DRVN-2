import type { ReactNode } from "react";

import { cx } from "@/lib/format";

import { Icon, type IconName } from "./icons";

/**
 * The one badge system for what a card IS and what state it is IN.
 *
 * - **Kind** (`variant="kind"`) — Build · Update · For sale. A neutral
 *   outline with the segment's icon, identical on every card: the word says
 *   the kind, so kind never spends colour.
 * - **State** (`variant="state"`, the default) — Used · Grade B · Sold ·
 *   Reserved. A tint. `tone` is colour only for a real state: `neutral` for
 *   a plain fact (condition, grade), `ok` for settled good news, `live` for
 *   something happening now, `spent` for over (sold, archived).
 *
 * Emits the `.chip` recipe (`.chip--kind` / `.chip--state` + tone), so a
 * context sizes it with a class (`.mcell__kind`, `.feedrow__kind`) rather
 * than a second recipe.
 */
export type BadgeTone = "neutral" | "ok" | "live" | "spent";

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "chip--state",
  ok: "chip--ok",
  live: "chip--live",
  spent: "chip--spent",
};

export function Badge({
  variant = "state",
  tone = "neutral",
  icon,
  className,
  children,
}: {
  variant?: "kind" | "state";
  /** State badges only. */
  tone?: BadgeTone;
  icon?: IconName;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cx("chip", variant === "kind" ? "chip--kind" : TONE_CLASS[tone], className)}>
      {icon && <Icon name={icon} className="chip__ico" />}
      {children}
    </span>
  );
}

/** The feed's three kinds, named and drawn the same way everywhere (the
 *  icons are Explore's segment icons). */
export type FeedKind = "car" | "update" | "part";

const KIND: Record<FeedKind, { label: string; icon: IconName }> = {
  car: { label: "Build", icon: "garage" },
  update: { label: "Update", icon: "image" },
  part: { label: "For sale", icon: "market" },
};

export function KindBadge({ kind, className }: { kind: FeedKind; className?: string }) {
  const { label, icon } = KIND[kind];
  return (
    <Badge variant="kind" icon={icon} className={className}>
      {label}
    </Badge>
  );
}
