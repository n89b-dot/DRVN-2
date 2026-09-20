import { AccountRowList, type AccountRowAccount } from "@/components/commerce";
import { FilterGroup, FilterLink } from "@/components/ui";

/**
 * E-4 — the full-width rows between the cards.
 *
 * Each ships with its own query and **renders only when it has enough to
 * show**. That rule is the whole design: a breaker with two chips in it,
 * or a "Builders to follow" row with one person, reads as a bug rather than
 * a feature, and an empty shell reads as a broken page. Below the threshold
 * the wall simply carries on, and nobody knows the breaker exists.
 */

const MIN_ITEMS = 3;

export function TrendingBreaker({
  models,
}: {
  models: { make: string; model: string; builds: number }[];
}) {
  if (models.length < MIN_ITEMS) return null;
  return (
    <div className="mosaic--breaker" role="listitem">
      <span className="microlabel microlabel--ink">Trending now</span>
      <FilterGroup label="" ariaLabel="Trending models" stack>
        {models.map((m) => (
          <FilterLink
            key={`${m.make}-${m.model}`}
            href={`/explore?q=${encodeURIComponent(`${m.make} ${m.model}`)}`}
            selected={false}
            count={m.builds}
          >
            {m.make} {m.model}
          </FilterLink>
        ))}
      </FilterGroup>
    </div>
  );
}

export function BuildersBreaker({ builders }: { builders: AccountRowAccount[] }) {
  if (builders.length < MIN_ITEMS) return null;
  return (
    <div className="mosaic--breaker" role="listitem">
      <span className="microlabel microlabel--ink">Builders to follow</span>
      <AccountRowList accounts={builders} />
    </div>
  );
}
