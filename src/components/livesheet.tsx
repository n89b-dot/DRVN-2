"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from "react";

import { useReducedMotion } from "@/lib/hooks/useReducedMotion";

/* ------------------------------------------------------------------ */
/* Rv — Livesheet spring reveal (.rv → .is-in), staggered per index.  */
/* ------------------------------------------------------------------ */

export function Rv({
  children,
  as,
  stagger = 0,
  className = "",
  style,
}: {
  children: ReactNode;
  as?: ElementType;
  /** Stagger index — delays entry by index × 70ms (mockup convention). */
  stagger?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const Tag = (as ?? "div") as ElementType;
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce || !("IntersectionObserver" in window)) {
      el.classList.add("is-in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          window.setTimeout(() => el.classList.add("is-in"), stagger * 70);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    // Guarantee: content must never stay hidden because the observer couldn't
    // fire — zero-size viewports (hidden/background tabs) report no
    // intersection at all, which left page headers frozen at opacity 0.
    const failsafe = window.setTimeout(
      () => el.classList.add("is-in"),
      900 + stagger * 70,
    );
    return () => {
      io.disconnect();
      window.clearTimeout(failsafe);
    };
  }, [reduce, stagger]);

  return (
    <Tag ref={ref} className={`rv ${className}`} style={style}>
      {children}
    </Tag>
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
