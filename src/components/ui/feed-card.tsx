import Link from "next/link";

import type { FeedItem } from "@/lib/feed";
import { formatPrice } from "@/lib/marketplace/taxonomy";

import { Icon } from "./icons";
import { Media } from "./primitives";

/**
 * Explore bento cards, per the Figma reference — four variants sharing one
 * chrome (#333 fill, #353945 border, 21px radius):
 *  A. image-top    — media, author/title/body, reply pill + heart
 *  B. tall-image   — portrait media, author/title/body, reply pill + heart
 *  C. quote        — text block, media, second text block, comment/repost/heart counts
 *  D. text-only    — avatar, author/title/long body, reply pill + heart
 */

const CARD_CLASS =
  "block overflow-hidden rounded-[21px] border border-border bg-[#333333] transition hover:border-text-muted";

function AuthorLine({ name }: { name: string | null }) {
  return <p className="text-[11px] text-[#777E90]">{name ?? "—"}</p>;
}

function TextBlock({
  author,
  title,
  body,
  clampBody,
}: {
  author: string | null;
  title: string;
  body: string | null;
  clampBody?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <AuthorLine name={author} />
      <p className="text-[13px] font-semibold leading-5 text-[#FCFCFD]">{title}</p>
      {body && (
        <p className={`text-[12px] leading-[19px] text-[#E6E8EC] ${clampBody ? "line-clamp-3" : ""}`}>
          {body}
        </p>
      )}
    </div>
  );
}

function ReplyFooter() {
  return (
    <div className="flex items-center gap-3 px-4 pb-4">
      <div className="flex h-9 flex-1 items-center justify-between rounded-lg bg-[#222222] px-3 text-xs text-[#888888]">
        Reply directly…
        <Icon name="smile" className="h-4 w-4 text-[#777E90]" />
      </div>
      <Icon name="heart" className="h-4 w-4 shrink-0 text-[#EEEEEE]" />
    </div>
  );
}

function CountsFooter({ reactions }: { reactions: number }) {
  return (
    <div className="flex items-center gap-6 px-4 pb-4 text-[#777E90]">
      <Icon name="comment" className="h-4 w-4" />
      <Icon name="repost" className="h-4 w-4" />
      <span className="ml-auto flex items-center gap-1.5 text-xs">
        <Icon name="heart" className="h-4 w-4" />
        {reactions > 0 ? reactions : ""}
      </span>
    </div>
  );
}

function CircleAvatar({ url, alt }: { url: string | null; alt: string }) {
  return url ? (
    <Media src={url} alt={alt} className="h-9 w-9 rounded-full" />
  ) : (
    <span className="grid h-9 w-9 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_25%,#4B83D6,#111315_70%)] text-[10px] font-bold text-white">
      {alt.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function FeedCard({ item, variantHint = 0 }: { item: FeedItem; variantHint?: number }) {
  if (item.kind === "part") {
    return (
      <Link href={`/listings/${item.id}`} className={CARD_CLASS}>
        <Media src={item.cover_url ?? undefined} alt={item.title} className="h-40 w-full" />
        <div className="grid gap-1.5 px-4 pb-3 pt-3.5">
          <p className="text-[11px] text-[#777E90]">Part for sale</p>
          <p className="text-[13px] font-semibold leading-5 text-[#FCFCFD]">{item.title}</p>
          <p className="text-[13px] font-bold text-[#FCFCFD]">{formatPrice(item.price_cents)}</p>
        </div>
        <ReplyFooter />
      </Link>
    );
  }

  if (item.kind === "car") {
    // Variant B: tall image.
    return (
      <Link href={`/cars/${item.slug}`} className={CARD_CLASS}>
        <Media src={item.cover_url ?? undefined} alt={item.name} className="h-64 w-full" />
        <div className="px-4 pb-3 pt-3.5">
          <TextBlock author={item.ownerName} title={item.name} body={item.meta || null} />
        </div>
        <ReplyFooter />
      </Link>
    );
  }

  const href = `/cars/${item.carSlug}/activity/${item.id}`;

  if (!item.cover_url) {
    // Variant D: text-only with avatar.
    return (
      <Link href={href} className={CARD_CLASS}>
        <div className="grid gap-2.5 px-4 pb-3 pt-4">
          <CircleAvatar url={item.avatar_url} alt={item.ownerName ?? "?"} />
          <TextBlock author={item.ownerName} title={item.title} body={item.intro} />
        </div>
        <ReplyFooter />
      </Link>
    );
  }

  if (variantHint % 2 === 1) {
    // Variant C: quote card — text, media, quoted text, counts row.
    return (
      <Link href={href} className={CARD_CLASS}>
        <div className="px-4 pb-3 pt-3.5">
          <TextBlock author={item.ownerName} title={item.title} body={item.intro} clampBody />
        </div>
        <div className="px-4 pb-3">
          <Media src={item.cover_url} alt={item.title} className="h-44 w-full rounded-[14px]" />
        </div>
        <div className="px-4 pb-3">
          <TextBlock author={item.ownerName} title={item.title} body={item.intro} clampBody />
        </div>
        <CountsFooter reactions={item.reactions} />
      </Link>
    );
  }

  // Variant A: image-top.
  return (
    <Link href={href} className={CARD_CLASS}>
      <Media src={item.cover_url} alt={item.title} className={`${variantHint % 4 === 2 ? "h-64" : "h-44"} w-full`} />
      <div className="px-4 pb-3 pt-3.5">
        <TextBlock author={item.ownerName} title={item.title} body={item.intro} clampBody />
      </div>
      <ReplyFooter />
    </Link>
  );
}

/** Four-column CSS masonry per the Figma explore grid. */
export function MasonryFeed({ items }: { items: FeedItem[] }) {
  if (!items.length) {
    return <p className="text-sm text-text-muted">Nothing here yet — check back soon.</p>;
  }
  return (
    <div className="columns-1 gap-5 sm:columns-2 lg:columns-3 xl:columns-4 [&>*]:mb-5 [&>*]:break-inside-avoid">
      {items.map((item, index) => (
        <FeedCard key={`${item.kind}-${item.id}`} item={item} variantHint={index} />
      ))}
    </div>
  );
}
