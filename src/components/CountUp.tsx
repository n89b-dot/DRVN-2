"use client";

import { useEffect, useRef, useState } from "react";

import { useReducedMotion } from "@/lib/hooks/useReducedMotion";

interface CountUpProps {
  /** Final numeric value to animate toward. */
  value: number;
  /** Optional prefix (e.g. "$") and suffix (e.g. "k", "%"). */
  prefix?: string;
  suffix?: string;
  /** Animation duration in milliseconds. */
  durationMs?: number;
  className?: string;
}

const DEFAULT_DURATION_MS = 1400;

/**
 * Animates a number from 0 to `value` the first time it scrolls into view, then
 * holds. Uses requestAnimationFrame with an ease-out curve for a tactile
 * "spinning up" feel. Honors reduced-motion by rendering the final value
 * immediately.
 *
 * Locale formatting matches the rest of the app (thousands separators).
 */
export function CountUp({
  value,
  prefix = "",
  suffix = "",
  durationMs = DEFAULT_DURATION_MS,
  className = "",
}: CountUpProps) {
  const prefersReducedMotion = useReducedMotion();
  const [displayValue, setDisplayValue] = useState(0);
  const elementRef = useRef<HTMLSpanElement>(null);
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }

    const element = elementRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || hasAnimatedRef.current) return;
        hasAnimatedRef.current = true;

        const startTime = performance.now();
        const tick = (now: number) => {
          const progress = Math.min((now - startTime) / durationMs, 1);
          // Ease-out cubic: fast start, gentle settle.
          const eased = 1 - Math.pow(1 - progress, 3);
          setDisplayValue(Math.round(value * eased));
          if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [durationMs, prefersReducedMotion, value]);

  return (
    <span ref={elementRef} className={className}>
      {prefix}
      {(prefersReducedMotion ? value : displayValue).toLocaleString()}
      {suffix}
    </span>
  );
}
