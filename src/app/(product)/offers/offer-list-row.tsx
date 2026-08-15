import Link from "next/link";

import { Media } from "@/components/ui";
import { cx } from "@/lib/format";
import { formatPrice } from "@/lib/marketplace/taxonomy";

import { StatusChip } from "../orders/order-pipeline";

export type OfferListItem = {
  id: string;
  listing_id: string;
  listing_title: string;
  listing_cover_url: string | null;
  counterparty_name: string;
  amount_cents: number;
  counter_amount_cents: number | null;
  status: string;
  created_at: string;
  /** Pre-formatted on the server — a countdown needs the current clock, and
   *  reading it during render isn't pure. */
  expiresLabel: string | null;
  unread: boolean;
  /** This row is waiting on *this* viewer: an open offer they received, or a
   *  counter that came back on one they made. */
  needsYou: boolean;
};

/**
 * One row of the /offers list.
 *
 * Ordered by what a decision actually needs: whether it's waiting on you,
 * then the part, then the money, then who and by when — status last, because
 * "open" is the least informative thing on a row that's already shouting for
 * an answer. The negotiation itself is one tap away in the thread.
 */
export function OfferListRow({ offer, incoming }: { offer: OfferListItem; incoming: boolean }) {
  const live = offer.status === "open" || offer.status === "countered";

  return (
    <Link
      href={`/offers/${offer.id}`}
      className={cx(
        "jobrow offerrow flex items-start gap-3 transition-colors hover:bg-[color:var(--paper-deep)]",
        offer.needsYou && "offerrow--needs"
      )}
    >
      <span className="tile__img block h-14 w-14 shrink-0 overflow-hidden rounded-[2px]">
        <Media
          src={offer.listing_cover_url ?? undefined}
          alt={offer.listing_title}
          className="h-full w-full"
          fallbackClassName="plate-undrawn"
          role="row"
        />
      </span>

      <span className="min-w-0 flex-1">
        {/* 1 — what this row wants from you, before anything else. */}
        {(offer.needsYou || offer.unread) && (
          <span className="offerrow__flags">
            {offer.needsYou && <span className="chip chip--live">Needs you</span>}
            {offer.unread && (
              <span className="chip chip--live" aria-label="Unread messages">
                New message
              </span>
            )}
          </span>
        )}

        <span className="flex flex-wrap items-center justify-between gap-2">
          {/* 2 — the part. */}
          <span className="order__name min-w-0 truncate">{offer.listing_title}</span>
          {/* 3/4 — the offer, then the counter that answered it. */}
          <span className="kv shrink-0 font-medium">
            {formatPrice(offer.amount_cents)}
            {offer.counter_amount_cents !== null && (
              <> → {formatPrice(offer.counter_amount_cents)}</>
            )}
          </span>
        </span>

        {/* 5/6 — who, and by when. */}
        <span className="order__meta mt-0.5 block">
          {incoming ? `${offer.counterparty_name} makes the offer` : `To ${offer.counterparty_name}`}
          {" · "}
          {new Date(offer.created_at).toLocaleDateString()}
          {live && offer.expiresLabel && <> · {offer.expiresLabel}</>}
        </span>

        {/* 7 — status, quietest of all: the flags above already said it. */}
        <span className="mt-1.5 block">
          <StatusChip status={offer.status} />
        </span>
      </span>
    </Link>
  );
}
