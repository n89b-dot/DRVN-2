"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { motion, useInView } from "motion/react";

import { Media } from "@/components/ui";
import { cx } from "@/lib/format";
import { springs, transitions } from "@/lib/motion";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";

/**
 * Build Evolution (brief §V) — the car's story as a visual strip, derived
 * ENTIRELY from what already exists: dated published updates and their
 * photos. Oldest → newest, one representative image per milestone, year
 * markers where the year turns. A horizontal scroll-snap strip (native
 * swipe on touch, wheel/keyboard on desktop) — a story, never an audit log:
 * no snapshots, no diffs, no extra data entry.
 *
 * Narrative motion: when the strip enters the viewport, the drafting rule
 * (`.dimline-h`, driven by the `is-in` cascade at `draw` timing) sweeps
 * across the header and the milestones settle in oldest → newest — the
 * timeline literally draws itself in chronological order. Under reduced
 * motion everything renders settled immediately.
 */

export type EvolutionMilestone = {
  id: string;
  /** ISO date of the update. */
  publishedAt: string;
  title: string;
  imageUrl: string;
  href: string;
};

export function BuildEvolution({ milestones }: { milestones: EvolutionMilestone[] }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const [forced, setForced] = useState(false);

  // Same guarantee as Rv: the story must never stay hidden because the
  // observer couldn't fire (zero-size viewports, background tabs).
  useEffect(() => {
    const failsafe = window.setTimeout(() => setForced(true), 1200);
    return () => window.clearTimeout(failsafe);
  }, []);

  if (milestones.length < 2) return null;
  const ordered = [...milestones].sort(
    (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
  );

  // Precompute year markers (a render map must not mutate).
  const stops = ordered.map((milestone, index) => {
    const year = String(new Date(milestone.publishedAt).getFullYear());
    const prev = index > 0 ? String(new Date(ordered[index - 1].publishedAt).getFullYear()) : null;
    return { milestone, year, showYear: year !== prev };
  });

  const shown = reduce || inView || forced;

  return (
    <section ref={ref} className={cx("evo", shown && "is-in")} aria-label="Build evolution">
      <div className="bsec">
        <span className="microlabel microlabel--ink">Build evolution</span>
        <span className="microlabel">
          {new Date(ordered[0].publishedAt).getFullYear()} →{" "}
          {new Date(ordered[ordered.length - 1].publishedAt).getFullYear()}
        </span>
      </div>
      {/* The timeline's own rule — drawn in by the `.is-in` cascade. */}
      <div className="dimline-h" aria-hidden="true" />
      <div className="evo__track" tabIndex={0} role="list">
        {stops.map(({ milestone, year, showYear }, index) => {
          const date = new Date(milestone.publishedAt);
          return (
            <motion.div
              key={milestone.id}
              role="listitem"
              className="evo__stop"
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={
                shown
                  ? {
                      opacity: 1,
                      y: 0,
                      transition: {
                        ...springs.gentle,
                        // Chronological settle — oldest first, capped so a
                        // long build doesn't keep the recent past waiting.
                        delay: Math.min(index, 8) * 0.07,
                        opacity: { ...transitions.move, delay: Math.min(index, 8) * 0.07 },
                      },
                    }
                  : undefined
              }
            >
              {showYear && <span className="evo__year">{year}</span>}
              <Link href={milestone.href} className="evo__card">
                <Media
                  src={milestone.imageUrl}
                  alt={milestone.title}
                  className="evo__img"
                  role="card"
                />
                <span className="evo__meta">
                  <span className="evo__date">
                    {date.toLocaleDateString(undefined, { month: "short" })}
                  </span>
                  <span className="evo__title">{milestone.title}</span>
                </span>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
