import Link from "next/link";

import type { FeedItem } from "@/lib/feed";
import { formatPrice } from "@/lib/marketplace/taxonomy";

import { Media } from "./primitives";

function KindChip({ children, tone }: { children: string; tone: "live" | "ok" | "neutral" }) {
  // "live" renders ink, not red: a listed part is the feed's normal state
  // (same demotion as the Explore cards) — red stays reserved for live-now.
  const cls = tone === "live" ? "chip chip--ink" : tone === "ok" ? "chip chip--ok" : "chip";
  return <span className={`${cls} feedrow__kind`}>{children}</span>;
}

/**
 * Home's feed rows — one ruled row per item: a real thumbnail, a headline,
 * one quiet line of context, and the kind as a small chip at the end.
 *
 * Its own `.feedrow` recipe rather than the offers' `.order` row: an offer
 * row is a ledger line (56px thumb, mono 16px metadata), which read as a
 * wall of monospace here. Feed rows breathe — a 112×84 plate, a 15px
 * headline, 13px sans context, an update's intro clamped to two lines.
 */
export function FeedList({ items }: { items: FeedItem[] }) {
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

  return (
    <div className="rowlist feedrows">
      {items.map((item) => {
        if (item.kind === "update") {
          return (
            <Link
              key={`update-${item.id}`}
              href={`/cars/${item.carSlug}/activity/${item.id}`}
              className="order feedrow"
            >
              <span className="order__img feedrow__img" aria-hidden="true">
                <Media src={item.cover_url ?? undefined} alt="" className="h-full w-full" role="row" />
              </span>
              <span className="feedrow__body">
                <span className="feedrow__name">{item.title}</span>
                <span className="feedrow__meta">
                  {[item.carName, item.ownerName].filter(Boolean).join(" · ")}
                </span>
                {item.intro && <span className="feedrow__intro">{item.intro}</span>}
              </span>
              <span className="order__actions feedrow__end">
                <KindChip tone="neutral">Update</KindChip>
              </span>
            </Link>
          );
        }

        if (item.kind === "car") {
          return (
            <Link key={`car-${item.id}`} href={`/cars/${item.slug}`} className="order feedrow">
              <span className="order__img feedrow__img" aria-hidden="true">
                <Media src={item.cover_url ?? undefined} alt="" className="h-full w-full" role="row" />
              </span>
              <span className="feedrow__body">
                <span className="feedrow__name">{item.name}</span>
                <span className="feedrow__meta">
                  {item.meta && <span className="vref vref--value">{item.meta}</span>}
                  {item.meta && item.ownerName ? " · " : ""}
                  {item.ownerName ?? ""}
                </span>
              </span>
              <span className="order__actions feedrow__end">
                <KindChip tone="neutral">Build</KindChip>
              </span>
            </Link>
          );
        }

        return (
          <Link key={`part-${item.id}`} href={`/listings/${item.id}`} className="order feedrow">
            <span className="order__img feedrow__img" aria-hidden="true">
              <Media src={item.cover_url ?? undefined} alt="" className="h-full w-full" role="row" />
            </span>
            <span className="feedrow__body">
              <span className="feedrow__name">{item.title}</span>
              <span className="feedrow__meta">
                <span className="feedrow__price">{formatPrice(item.price_cents)}</span>
                {typeof item.shipping_cents === "number"
                  ? item.shipping_cents > 0
                    ? ` · + ${formatPrice(item.shipping_cents)} shipping`
                    : " · shipping included"
                  : ""}
                {item.sourceCarName ? (
                  <>
                    {" · "}
                    <span className="vref vref--value">{item.sourceCarName}</span>
                  </>
                ) : null}
              </span>
            </span>
            <span className="order__actions feedrow__end">
              <KindChip tone="live">For sale</KindChip>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
