"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { motion, useInView } from "motion/react";

/* Motion components are stateful — declared once at module scope, picked by
   name during render. Add a tag here if a page needs a new semantic reveal
   element. */
const MOTION_TAGS = {
  div: motion.div,
  header: motion.header,
  section: motion.section,
  article: motion.article,
  aside: motion.aside,
  footer: motion.footer,
  span: motion.span,
  p: motion.p,
  ul: motion.ul,
  li: motion.li,
} as const;

export type RvTag = keyof typeof MOTION_TAGS;

import { reveal } from "@/lib/motion";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";

/* ------------------------------------------------------------------ */
/* Rv — Livesheet spring reveal, staggered per index.                 */
/* Motion for React drives the rise/fade (shared `reveal` recipe);    */
/* the `is-in` class is still applied at the same moment because the  */
/* drafting cascade keys off it in CSS (.is-in .dimline-h draws, the  */
/* pagehead live-word underline sweeps, gsheet dimension spines pull  */
/* in). One state, two renderers — never two timelines.               */
/* ------------------------------------------------------------------ */

export function Rv({
  children,
  as,
  stagger = 0,
  className = "",
  style,
}: {
  children: ReactNode;
  as?: RvTag;
  /** Stagger index — delays entry by index × 70ms (mockup convention). */
  stagger?: number;
  className?: string;
  style?: CSSProperties;
}) {
  // The union of per-tag component types defeats ref inference; every tag
  // here renders an HTMLElement, so the div signature is safe to assume.
  const MotionTag = MOTION_TAGS[as ?? "div"] as typeof motion.div;
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true, amount: 0.15 });
  const [forced, setForced] = useState(false);

  // Guarantee: content must never stay hidden because the observer couldn't
  // fire — zero-size viewports (hidden/background tabs) report no
  // intersection at all, which left page headers frozen at opacity 0.
  useEffect(() => {
    const failsafe = window.setTimeout(() => setForced(true), 900 + stagger * 70);
    return () => window.clearTimeout(failsafe);
  }, [stagger]);

  // Page headers must be readable before hydration/IntersectionObserver.
  const immediate = as === "header";
  const shown = immediate || reduce || inView || forced;

  return (
    <MotionTag
      ref={ref}
      data-reveal="true"
      className={`${shown ? "is-in " : ""}${className}`}
      style={style}
      variants={reveal}
      custom={stagger * 0.07}
      // Under reduced motion the content simply starts settled — no hidden
      // frame, no animation, matching the old `.rv` contract exactly.
      initial={immediate || reduce ? false : "hidden"}
      animate={shown ? "visible" : "hidden"}
    >
      {children}
    </MotionTag>
  );
}

/* ------------------------------------------------------------------ */
/* LiveDim — the signature drafting leader line with a measured value. */
/* ------------------------------------------------------------------ */

export function LiveDim({
  label,
  value,
  live = false,
  blank = false,
  className = "",
}: {
  label: ReactNode;
  value?: ReactNode;
  /** The measured value is genuinely live — red value + pulsing dot. */
  live?: boolean;
  /** Nothing to measure yet — dashed spine, dim value. */
  blank?: boolean;
  className?: string;
}) {
  const variant = live ? " livedim--live" : blank ? " livedim--blank" : "";
  return (
    <div className={`livedim${variant} ${className}`}>
      <span className="microlabel">{label}</span>
      {value !== undefined && <span className="val">{value}</span>}
      <span className="livedim__tick" aria-hidden="true" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Countdown — H:MM:SS from an absolute expiry. Server-authoritative:  */
/* takes expiresAt; keeps ticking under reduced motion (information,   */
/* not decoration). Renders — until mounted to avoid hydration drift.  */
/* ------------------------------------------------------------------ */

function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return (h > 0 ? `${h}:` : "") + `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function Countdown({
  expiresAt,
  className = "cd",
}: {
  expiresAt: string | number | Date;
  className?: string;
}) {
  const [now, setNow] = useState<number | null>(() =>
    typeof window === "undefined" ? null : Date.now(),
  );

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const target = new Date(expiresAt).getTime();
  return (
    <span className={className} suppressHydrationWarning>
      {now === null ? "—" : formatRemaining(target - now)}
    </span>
  );
}
