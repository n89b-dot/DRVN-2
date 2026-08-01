import Link from "next/link";

import type { FeedItem } from "@/lib/feed";
import { formatPrice } from "@/lib/marketplace/taxonomy";

import { Media } from "./primitives";

function KindChip({ children, tone }: { children: string; tone: "live" | "ok" | "neutral" }) {
  const cls = tone === "live" ? "chip chip--live" : tone === "ok" ? "chip chip--ok" : "chip";
  return <span className={cls}>{children}</span>;
}

/** Strong content-type labels so cars / updates / parts never blur (PRD §8.2).
 *  Rendered as Livesheet ruled rows — label · value · status on one rule. */
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
    <div className="rowlist">
      {items.map((item) => {
        if (item.kind === "update") {
          return (
            <Link
              key={`update-${item.id}`}
              href={`/cars/${item.carSlug}/activity/${item.id}`}
              className="order"
            >
              <span>
                <span className="order__name block">{item.title}</span>
                <span className="order__meta block">
                  {item.carName}
                  {item.ownerName ? ` · ${item.ownerName}` : ""}
                  {item.intro ? ` — ${item.intro}` : ""}
                </span>
              </span>
              <span className="order__actions">
                <KindChip tone="neutral">Update</KindChip>
              </span>
            </Link>
          );
        }

        if (item.kind === "car") {
          return (
            <Link key={`car-${item.id}`} href={`/cars/${item.slug}`} className="order">
              <span className="order__img">
                <Media src={item.cover_url ?? undefined} alt={item.name} className="h-full w-full" />
              </span>
              <span>
                <span className="order__name block">{item.name}</span>
                <span className="order__meta block">
                  {item.ownerName ?? "build"}
                  {item.meta ? ` · ${item.meta}` : ""}
                </span>
              </span>
              <span className="order__actions">
                <KindChip tone="neutral">Build</KindChip>
              </span>
            </Link>
          );
        }

        return (
          <Link key={`part-${item.id}`} href={`/listings/${item.id}`} className="order">
            <span className="order__img">
              <Media src={item.cover_url ?? undefined} alt={item.title} className="h-full w-full" />
            </span>
            <span>
              <span className="order__name block">{item.title}</span>
              <span className="order__meta block">{formatPrice(item.price_cents)}</span>
            </span>
            <span className="order__actions">
              <KindChip tone="live">For sale</KindChip>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
