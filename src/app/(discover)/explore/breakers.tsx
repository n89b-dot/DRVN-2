import { AccountRowList, type AccountRowAccount } from "@/components/commerce";
import { ButtonLink, FilterGroup, FilterLink } from "@/components/ui";
import { FollowButton } from "@/features/social/buttons";

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
        {/* Six at most: on a phone ten chips stacked to half a screen of
            links, which is a list, not a breaker. */}
        {models.slice(0, 6).map((m) => (
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

export function BuildersBreaker({
  builders,
  isLoggedIn = false,
}: {
  builders: AccountRowAccount[];
  isLoggedIn?: boolean;
}) {
  if (builders.length < MIN_ITEMS) return null;
  return (
    <div className="mosaic--breaker peoplerows" role="listitem">
      <span className="microlabel microlabel--ink">Builders to follow</span>
      {/* The breaker is literally "to follow", so each row can be acted on:
          signed out, Follow explains why an account is needed. */}
      <AccountRowList
        accounts={builders}
        action={(account) => (
          <FollowButton
            targetType="profile"
            targetId={account.id}
            path="/explore"
            initialFollowing={false}
            isLoggedIn={isLoggedIn}
          />
        )}
      />
    </div>
  );
}

/**
 * The visitor's join moment. Signed out, the wall used to have no line on
 * what DRVN is and no invitation to make one of these pages — someone who
 * arrived from a shared link had no reason to sign up. Signed-out only, and
 * shaped like the other breakers (a full-width row), so it adds no layout.
 */
export function JoinBreaker() {
  return (
    <div className="mosaic--breaker" role="listitem">
      <span className="microlabel microlabel--ink">Put your car on DRVN</span>
      <p className="max-w-[60ch] text-body text-dim">
        Every build on this wall started with someone adding their car. Yours gets a page like
        these — the mods, the updates, and the car behind any part you sell off it.
      </p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/signup?next=%2Fgarage">Add your car</ButtonLink>
        <ButtonLink href="/login?next=%2Fexplore" variant="ghost">
          Sign in
        </ButtonLink>
      </div>
    </div>
  );
}
