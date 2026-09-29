import Link from "next/link";

import type { FeedItem } from "@/lib/feed";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { vehicleSubline } from "@/lib/vehicles/label";

import { KindBadge, type FeedKind } from "./badge";
import { Media } from "./primitives";
import { postHref } from "@/lib/activity/href";
import { relativeTime } from "@/lib/format";
import { CardEngagement, type EngagementTarget } from "@/features/social/card-actions";

type Row = {
  key: string;
  href: string;
  cover: string | null;
  kind: FeedKind;
  title: string;
  /** One quiet line of context under the title. */
  meta: React.ReactNode;
  intro?: string | null;
  /** "4w ago" — the card's time stamp. */
  when: string;
  /** What the card's like · comment · share · save strip acts on. */
  engage: {
    target: EngagementTarget;
    liked: boolean;
    likes: number;
    saved: boolean;
    commentCount?: number;
    /** Posts and parts have a conversation to open; a build doesn't. */
    commentHref?: string;
  };
};

function shipText(cents: number | null): string {
  if (typeof cents !== "number") return "";
  return cents > 0 ? ` · + ${formatPrice(cents)} shipping` : " · shipping included";
}

/** One description per item, read by both layouts — so a row and a card can
 *  never disagree on what an item is called or what it says under its name. */
function describe(item: FeedItem): Row {
  if (item.kind === "update") {
    return {
      key: `update-${item.id}`,
      href: postHref({ id: item.id, carSlug: item.carSlug }),
      cover: item.cover_url,
      kind: "update",
      title: item.title,
      meta: [item.carName, item.ownerName].filter(Boolean).join(" · "),
      intro: item.intro,
      when: relativeTime(item.created_at),
      engage: {
        target: { kind: "post", id: item.id },
        liked: Boolean(item.viewerLiked),
        likes: item.reactions,
        saved: Boolean(item.viewerSaved),
        commentCount: item.commentCount ?? 0,
        commentHref: postHref({ id: item.id, carSlug: item.carSlug }),
      },
    };
  }
  if (item.kind === "car") {
    // A nameless car is named by its model, so the model line would only say
    // the title again ("2007 Audi RS4 Avant / 2007 Audi RS4 Avant · …").
    const title = item.name.trim() || item.meta || "Build sheet";
    const vehicle = vehicleSubline(title, item.vehicle);
    const rest = [
      item.ownerName,
      item.forSaleCount > 0
        ? `${item.forSaleCount} part${item.forSaleCount === 1 ? "" : "s"} for sale`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      key: `car-${item.id}`,
      href: `/cars/${item.slug}`,
      cover: item.cover_url,
      kind: "car",
      title,
      when: relativeTime(item.lastActivityAt ?? item.created_at),
      engage: {
        target: { kind: "car", id: item.id },
        liked: Boolean(item.viewerLiked),
        likes: item.likeCount ?? 0,
        saved: Boolean(item.viewerSaved),
      },
      meta: (
        <>
          {vehicle && <span className="vref vref--value">{vehicle}</span>}
          {vehicle && rest ? " · " : ""}
          {rest}
        </>
      ),
    };
  }
  return {
    key: `part-${item.id}`,
    href: `/listings/${item.id}`,
    cover: item.cover_url,
    kind: "part",
    title: item.title,
    when: relativeTime(item.created_at),
    engage: {
      target: { kind: "listing", id: item.id },
      liked: Boolean(item.viewerLiked),
      likes: item.likeCount ?? 0,
      saved: Boolean(item.viewerSaved),
      commentCount: item.questionCount ?? 0,
      commentHref: `/listings/${item.id}`,
    },
    meta: (
      <>
        <span className="feedrow__price">{formatPrice(item.price_cents)}</span>
        {shipText(item.shipping_cents)}
        {item.sourceCarName ? (
          <>
            {" · "}
            <span className="vref vref--value">{item.sourceCarName}</span>
          </>
        ) : null}
      </>
    ),
  };
}

/**
 * Home's feed, in two layouts over one description of each item.
 *
 * - `cards` (Home's column) — photo first: a full-width plate, the kind as a
 *   small outline tag, then the headline and one line of context. Every post
 *   has a photo, so the column reads as cars rather than as an inbox.
 * - `rows` — the ruled list: a 112×84 plate beside the text, the kind chip at
 *   the end. For narrow contexts where a photo column would be too loud.
 */
export function FeedList({
  items,
  variant = "rows",
  eagerFirst = false,
  engagement,
}: {
  items: FeedItem[];
  variant?: "rows" | "cards";
  /** Cards only: the like · comment · share · save strip under each card —
   *  the same CardEngagement the Explore wall's cells carry. `path` is the
   *  page the toggles revalidate. */
  engagement?: { path: string; isLoggedIn: boolean };
  /** The list leads the page (Home's first cards): load the first card's
   *  photo eagerly at high priority, since it is the page's largest paint. */
  eagerFirst?: boolean;
}) {
  if (!items.length) {
    return (
      <div className="undrawn">
        <span className="undrawn__mark" aria-hidden="true">
          ✎
        </span>
        <h3>All quiet for now</h3>
        <p>New builds, updates and listings from around DRVN show up here.</p>
      </div>
    );
  }

  // W-2: posts from before the photo rule keep their pages, but the cards
  // column is a photo wall and a photo-less update on it is a blank plate —
  // they are left off here, as on Explore's wall (MasonryFeed).
  const shown = variant === "cards" ? items.filter((item) => item.kind !== "update" || item.cover_url) : items;
  if (!shown.length) return null;
  const rows = shown.map(describe);

  if (variant === "cards") {
    return (
      <div className="feedcards">
        {rows.map((row, i) => (
          <article key={row.key} className="feedcard">
            <Link href={row.href} className="feedcard__link">
              <span className="feedcard__img" aria-hidden="true">
                <Media
                  src={row.cover ?? undefined}
                  alt=""
                  className="h-full w-full"
                  role="feature"
                  eager={eagerFirst && i === 0}
                />
              </span>
              <span className="feedcard__body">
                <span className="feedcard__top">
                  <KindBadge kind={row.kind} className="feedcard__kind" />
                  <span className="microlabel">{row.when}</span>
                </span>
                <span className="feedcard__title">{row.title}</span>
                {row.meta && <span className="feedrow__meta">{row.meta}</span>}
                {row.intro && <span className="feedrow__intro">{row.intro}</span>}
              </span>
            </Link>
            {engagement && (
              <div className="feedcard__eng">
                <CardEngagement
                  target={row.engage.target}
                  path={engagement.path}
                  isLoggedIn={engagement.isLoggedIn}
                  initialLiked={row.engage.liked}
                  likeCount={row.engage.likes}
                  commentHref={row.engage.commentHref}
                  commentCount={row.engage.commentCount}
                  shareUrl={row.href}
                  initialSaved={row.engage.saved}
                  compact
                />
              </div>
            )}
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className="rowlist feedrows">
      {rows.map((row) => (
        <Link key={row.key} href={row.href} className="order feedrow">
          <span className="order__img feedrow__img" aria-hidden="true">
            <Media src={row.cover ?? undefined} alt="" className="h-full w-full" role="row" />
          </span>
          <span className="feedrow__body">
            <span className="feedrow__name">{row.title}</span>
            {row.meta && <span className="feedrow__meta">{row.meta}</span>}
            {row.intro && <span className="feedrow__intro">{row.intro}</span>}
          </span>
          <span className="order__actions feedrow__end">
            <KindBadge kind={row.kind} className="feedrow__kind" />
          </span>
        </Link>
      ))}
    </div>
  );
}
