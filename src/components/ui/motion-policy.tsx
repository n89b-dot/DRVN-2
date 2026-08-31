"use client";

import type { ReactNode } from "react";

import { MotionConfig } from "motion/react";

/**
 * MotionPolicy — the app-level motion contract, mounted once in the root
 * layout around `{children}` (which stay server-rendered; this only adds a
 * thin client provider, not a client tree).
 *
 * `reducedMotion="user"` makes every Motion-driven animation respect the OS
 * "reduce motion" preference: transform/layout animation is disabled while
 * opacity and color still transition, so state changes stay communicated
 * without spatial movement. CSS keeps its own `prefers-reduced-motion`
 * guards for the transitions it still owns — the two systems agree on the
 * same preference, they just each enforce it for the properties they drive.
 */
export function MotionPolicy({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
