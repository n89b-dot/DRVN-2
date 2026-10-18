/**
 * DRVN motion foundation — the single source of semantic motion values.
 *
 * Architecture: Motion for React (`motion/react`) owns behavioral and
 * structural animation (presence, layout, gestures, orchestration); CSS keeps
 * simple cosmetic transitions (hover colors, focus rings, ambient loading).
 * Both speak the same timing language defined here, which mirrors the
 * Livesheet CSS tokens in `src/app/styles/00-tokens-base.css` (`--t-fast` /
 * `--t-standard` / `--t-move` / `--t-draw`, `--spring`).
 *
 * Personality: precise, mechanical, controlled, slightly inertial — motion
 * that reads as well-engineered machinery, never rubbery or decorative.
 *
 * This module is pure configuration (no components, no "use client") so it
 * can be imported anywhere without creating a client boundary by itself.
 * Full guidance: /docs/motion (docs/site/motion.md).
 */

import type { Transition, Variants } from "motion/react";

/* ------------------------------------------------------------------ */
/* Durations — seconds, for Motion. Mirror the CSS `--t-*` tokens.     */
/* ------------------------------------------------------------------ */

export const durations = {
  /** Cosmetic feedback: hovers, color, small opacity. CSS `--t-fast`. */
  fast: 0.16,
  /** Default duration-based UI transition (fades, small state swaps). */
  standard: 0.24,
  /** Spatial movement: elements changing place or size. CSS `--t-move`. */
  move: 0.38,
  /** Narrative motion: provenance lines, sequential reveals. CSS `--t-draw`. */
  draw: 0.65,
} as const;

/* ------------------------------------------------------------------ */
/* Easing — the Livesheet spring curve for duration-based transitions. */
/* ------------------------------------------------------------------ */

/** CSS `--spring` as a Motion cubic-bezier — decisive start, soft landing. */
export const ease = [0.32, 0.72, 0, 1] as const;

/* ------------------------------------------------------------------ */
/* Springs — true physical motion for spatial/structural animation.    */
/* Tuned for a mechanical, controlled feel: high stiffness relative to */
/* mass, damping at or near critical so nothing visibly oscillates.    */
/* ------------------------------------------------------------------ */

export const springs = {
  /** Immediate mechanical feedback: presses, toggles, chips. */
  snappy: { type: "spring", stiffness: 500, damping: 34, mass: 0.7 } satisfies Transition,
  /** Default interactive settle: expanding rows, menus, small surfaces. */
  responsive: { type: "spring", stiffness: 380, damping: 32, mass: 0.9 } satisfies Transition,
  /** Structural movement: sheets, dialogs, layout reflow, list moves. */
  spatial: { type: "spring", stiffness: 260, damping: 30, mass: 1 } satisfies Transition,
  /** Calm settling for larger or narrative surfaces. Slight inertia, no bounce. */
  gentle: { type: "spring", stiffness: 170, damping: 26, mass: 1 } satisfies Transition,
} as const;

/* ------------------------------------------------------------------ */
/* Distances — conceptual travel ranges (px). Keep travel short.       */
/* ------------------------------------------------------------------ */

export const distances = {
  micro: 2,
  small: 6,
  medium: 12,
  large: 24,
} as const;

/* ------------------------------------------------------------------ */
/* Transitions — duration-based presets for non-spatial properties.    */
/* ------------------------------------------------------------------ */

export const transitions = {
  /** Opacity/color-class feedback at `fast`. */
  fast: { duration: durations.fast, ease } satisfies Transition,
  /** Default fade / small state swap. */
  standard: { duration: durations.standard, ease } satisfies Transition,
  /** Duration-based spatial move (when a spring is too lively). */
  move: { duration: durations.move, ease } satisfies Transition,
  /** Narrative draw — provenance lines, sequential storytelling. */
  draw: { duration: durations.draw, ease } satisfies Transition,
} as const;

/* ------------------------------------------------------------------ */
/* Recipes — the shared variant vocabulary. Spread into motion.*       */
/* elements; do not re-type these numbers in feature code.             */
/* ------------------------------------------------------------------ */

/**
 * Surface presence — dialogs, sheets, popover-scale surfaces appearing in
 * place. Short rise + fade; springs handle the transform, `fast` the opacity.
 */
export const surface: Variants = {
  hidden: { opacity: 0, y: distances.small, transition: transitions.fast },
  visible: {
    opacity: 1,
    y: 0,
    transition: { ...springs.responsive, opacity: transitions.fast },
  },
  exit: { opacity: 0, y: distances.micro, transition: transitions.fast },
};

/**
 * List item presence — insertion/removal in feeds, results, notifications.
 * Pair with `layout` on siblings so neighbors reflow instead of teleporting.
 */
export const listItem: Variants = {
  hidden: { opacity: 0, y: distances.small },
  visible: {
    opacity: 1,
    y: 0,
    transition: { ...springs.responsive, opacity: transitions.standard },
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    transition: transitions.fast,
  },
};

/**
 * Reveal-on-scroll — the Rv contract: rise ~12px with the spring curve.
 * Matches the retired `.rv → .is-in` CSS so existing pages read identically.
 * Dynamic: pass the entry delay (seconds) through `custom`.
 */
export const reveal: Variants = {
  hidden: { opacity: 0, y: distances.medium, scale: 0.985 },
  visible: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...transitions.move, delay, opacity: { ...transitions.move, ease: "easeOut", delay } },
  }),
};

/** Expand/collapse for disclosure regions driven by Motion height animation. */
export const expand: Variants = {
  collapsed: { height: 0, opacity: 0, transition: transitions.standard },
  expanded: {
    height: "auto",
    opacity: 1,
    transition: { ...springs.spatial, opacity: transitions.standard },
  },
};

/** Press feedback for buttons/pressables — barely-there mechanical give. */
export const press = {
  whileTap: { scale: 0.97 },
  transition: springs.snappy,
} as const;

/**
 * Stagger helper — orchestrate children without hand-timing delays.
 * Usage: `transition={{ ...stagger(0.07) }}` on a `visible` parent variant.
 */
export function stagger(step = 0.07, delayChildren = 0) {
  return { staggerChildren: step, delayChildren } as const;
}
