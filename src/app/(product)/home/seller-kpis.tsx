import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

import { Countdown, LiveDim } from "@/components/livesheet";
import { Alert, MetricCard } from "@/components/ui";
import type { Database } from "@/lib/database.types";
import { getConnectStatus } from "@/lib/payments/connect";
import { paymentsAreLive } from "@/lib/payments/provider";

/** "today" / "3d ago" / "2w ago" — the same feel-dates the garage sheets use. */
function ago(iso: string, nowMs: number): string {
  const d = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000));
  if (d === 0) return "today";
  if (d < 7) return `${d}d ago`;
  if (d < 35) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

/**
 * The seller's KPI deck (Werkbank C4). Four measured facts with a live
 * dimension line under each: what's listed, what needs an answer, how your
 * last update landed, and how many eyes are on your parts.
 *
 * The old takings and fitment tiles are gone — at this stage of the platform
 * both sat blank for almost everyone, and a deck of dashes teaches people the
 * page is dead. Views and update responses are alive from day one. The exact
 * money story still lives on the ledger, one link away.
 *
 * Renders nothing at all for someone who has never listed — an empty dashboard
 * of zeroes is worse than no dashboard.
 */
export async function SellerKpis({
  supabase,
  userId,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
}) {
  // Read the clock once, through `new Date()` — the purity lint rightly flags
  // bare `Date.now()` calls in a render path.
  const nowMs = new Date().getTime();

  const { data: listings } = await supabase
    .from("listings")
    .select("id, status, view_count")
    .eq("seller_id", userId);

  const mine = listings ?? [];
  if (!mine.length) return null;

  const listingIds = mine.map((l) => l.id);
  const activeIds = mine.filter((l) => l.status === "active").map((l) => l.id);
  const views = mine.reduce((sum, l) => sum + (l.view_count ?? 0), 0);

  const [{ data: offers }, { data: watchRows }, { data: latestPost }] = await Promise.all([
    supabase
      .from("offers")
      .select("id, expires_at, status")
      .in("listing_id", listingIds)
      .in("status", ["open", "countered"]),
    supabase
      .from("saves")
      .select("user_id")
      .eq("target_type", "listing")
      .in("target_id", listingIds),
    supabase
      .from("activity_posts")
      .select("id, car_id, title, published_at")
      .eq("author_id", userId)
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Watchers are people, not saves — one buyer watching three of your parts
  // is still one buyer.
  const watchers = new Set((watchRows ?? []).map((s) => s.user_id)).size;

  // How the latest update landed: reactions + comments on it, and where it
  // lives so the tile can open it.
  let responses = 0;
  let reactions = 0;
  let comments = 0;
  let postHref: string | null = null;
  if (latestPost) {
    const [{ count: reactionCount }, { count: commentCount }, { data: car }] = await Promise.all([
      supabase
        .from("activity_reactions")
        .select("post_id", { count: "exact", head: true })
        .eq("post_id", latestPost.id),
      supabase
        .from("activity_comments")
        .select("id", { count: "exact", head: true })
        .eq("post_id", latestPost.id),
      supabase.from("cars").select("slug").eq("id", latestPost.car_id).maybeSingle(),
    ]);
    reactions = reactionCount ?? 0;
    comments = commentCount ?? 0;
    responses = reactions + comments;
    postHref = car?.slug ? `/cars/${car.slug}/activity/${latestPost.id}` : null;
  }

  const openOffers = offers ?? [];
  const soonest = openOffers
    .map((o) => o.expires_at)
    .filter(Boolean)
    .sort()[0] as string | undefined;
  const underOffer = openOffers.length;

  // Payout onboarding surfaced where the seller already is (Rev E item 9) —
  // not only buried in Settings → Payments. Shown the moment it blocks
  // anything: publishing, or money that has nowhere to land.
  const needsOnboarding = paymentsAreLive() && !(await getConnectStatus(userId)).payoutsEnabled;

  return (
    <section className="deck deck--kpi">
      {needsOnboarding && (
        <Alert tone="live" className="col-span-full" title="Payouts aren't set up yet">
          Publishing needs somewhere to send the money when a part sells.{" "}
          <Link href="/settings#payments" className="jumplink !inline-flex">
            Finish payout setup →
          </Link>
        </Alert>
      )}
      {/* CTA tiles are columns with the jumplink pinned to the floor
          (mt-auto), so "Manage" and "Read it" share one baseline across the
          deck regardless of how tall each tile's facts run. */}
      <MetricCard
        label="Active listings"
        value={activeIds.length}
        stagger={0}
        footer={
          <Link href="/listings" className="jumplink mt-auto pt-2 self-start inline-flex">
            Manage your listings →
          </Link>
        }
      >
        <LiveDim
          label="On the marketplace"
          value={`${activeIds.length} live · ${mine.length} total`}
        />
      </MetricCard>

      <MetricCard
        label="Offers"
        live={underOffer > 0}
        value={underOffer || "—"}
        valueLive={underOffer > 0}
        blank={!underOffer}
        stagger={1}
      >
        {underOffer > 0 ? (
          <LiveDim
            label="Oldest lapses in"
            value={soonest ? <Countdown expiresAt={soonest} /> : "No window set"}
            live
          />
        ) : (
          <LiveDim label="Nothing waiting on you" value="—" blank />
        )}
      </MetricCard>

      {/* The latest update, measured by what came back — the tile quotes the
          post's own title, so it reads as being about the work, not metrics. */}
      <MetricCard
        label="Latest update"
        live={responses > 0}
        value={responses || "—"}
        blank={!responses}
        stagger={2}
        // The original tile is a flex column whether or not the jumplink is
        // present; MetricCard only adds it with a footer, so restore it when
        // there's no post to link.
        className={postHref ? undefined : "flex flex-col"}
        footer={
          postHref && (
            <Link href={postHref} className="jumplink mt-auto pt-2 self-start inline-flex">
              Read it →
            </Link>
          )
        }
      >
        {latestPost ? (
          <LiveDim
            label={`“${latestPost.title}” · ${ago(latestPost.published_at as string, nowMs)}`}
            value={
              responses
                ? [
                    reactions ? `${reactions} reaction${reactions === 1 ? "" : "s"}` : null,
                    comments ? `${comments} comment${comments === 1 ? "" : "s"}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "No responses yet"
            }
            live={responses > 0}
            blank={!responses}
          />
        ) : (
          <LiveDim label="Nothing posted yet" value="—" blank />
        )}
      </MetricCard>

      <MetricCard label="Eyes on your parts" value={views || "—"} blank={!views} stagger={3}>
        <LiveDim
          label={views ? "Part-sheet views, all time" : "Views land as buyers browse"}
          value={
            watchers
              ? `${watchers} watching closely`
              : views
                ? `${views} view${views === 1 ? "" : "s"}`
                : "—"
          }
          live={watchers > 0}
          blank={!views}
        />
      </MetricCard>

    </section>
  );
}
