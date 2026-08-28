import Link from "next/link";

import { Media } from "@/components/ui";

/**
 * Build Evolution (brief §V) — the car's story as a visual strip, derived
 * ENTIRELY from what already exists: dated published updates and their
 * photos. Oldest → newest, one representative image per milestone, year
 * markers where the year turns. A horizontal scroll-snap strip (native
 * swipe on touch, wheel/keyboard on desktop) — a story, never an audit log:
 * no snapshots, no diffs, no extra data entry.
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

  return (
    <section className="evo" aria-label="Build evolution">
      <div className="bsec">
        <span className="microlabel microlabel--ink">Build evolution</span>
        <span className="microlabel">
          {new Date(ordered[0].publishedAt).getFullYear()} →{" "}
          {new Date(ordered[ordered.length - 1].publishedAt).getFullYear()}
        </span>
      </div>
      <div className="evo__track" tabIndex={0} role="list">
        {stops.map(({ milestone, year, showYear }) => {
          const date = new Date(milestone.publishedAt);
          return (
            <div key={milestone.id} role="listitem" className="evo__stop">
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
            </div>
          );
        })}
      </div>
    </section>
  );
}
