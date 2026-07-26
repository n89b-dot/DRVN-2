import Link from "next/link";

import type { FeedItem } from "@/lib/feed";
import { formatPrice } from "@/lib/marketplace/taxonomy";

import { Media } from "./primitives";

function TypeLabel({ children, tone }: { children: string; tone: "blue" | "green" | "neutral" }) {
  const tones = {
    blue: "bg-accent/15 text-accent",
    green: "bg-success/15 text-success",
    neutral: "bg-raised text-text-muted",
  };
  return (
    <span className={`rounded-pill px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Strong content-type labels so cars / updates / parts never blur (PRD §8.2). */
export function FeedList({ items }: { items: FeedItem[] }) {
  if (!items.length) {
    return <p className="text-sm text-text-muted">Nothing here yet — check back soon.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        if (item.kind === "update") {
          return (
            <Link
              key={`update-${item.id}`}
              href={`/cars/${item.carSlug}/activity/${item.id}`}
              className="rounded-card border border-border bg-surface p-5 transition hover:border-text-muted"
            >
              <div className="flex items-center gap-2">
                <TypeLabel tone="blue">Build update</TypeLabel>
                <span className="text-xs text-text-muted">
                  {item.carName}
                  {item.ownerName ? ` · ${item.ownerName}` : ""}
                </span>
              </div>
              <p className="mt-2.5 font-semibold text-text-primary">{item.title}</p>
              {item.intro && (
                <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{item.intro}</p>
              )}
            </Link>
          );
        }

        if (item.kind === "car") {
          return (
            <Link
              key={`car-${item.id}`}
              href={`/cars/${item.slug}`}
              className="flex items-center gap-4 rounded-card border border-border bg-surface p-4 transition hover:border-text-muted"
            >
              <Media src={item.cover_url ?? undefined} alt={item.name} className="h-16 w-24 shrink-0 rounded-tile" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <TypeLabel tone="neutral">Car</TypeLabel>
                  {item.ownerName && <span className="text-xs text-text-muted">{item.ownerName}</span>}
                </div>
                <p className="mt-1.5 truncate font-semibold text-text-primary">{item.name}</p>
                {item.meta && <p className="mt-0.5 text-sm text-text-muted">{item.meta}</p>}
              </div>
            </Link>
          );
        }

        return (
          <Link
            key={`part-${item.id}`}
            href={`/listings/${item.id}`}
            className="flex items-center gap-4 rounded-card border border-border bg-surface p-4 transition hover:border-text-muted"
          >
            <Media src={item.cover_url ?? undefined} alt={item.title} className="h-16 w-24 shrink-0 rounded-tile" />
            <div className="min-w-0">
              <TypeLabel tone="green">Part for sale</TypeLabel>
              <p className="mt-1.5 truncate font-semibold text-text-primary">{item.title}</p>
              <p className="mt-0.5 text-sm font-semibold text-text-secondary">
                {formatPrice(item.price_cents)}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
