import Link from "next/link";

import { Media } from "@/components/ui";
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
};

/** One row of the /offers list — thumbnail, amounts, status, and a link
 *  into the full thread rather than the inline conversation it replaces. */
export function OfferListRow({ offer, incoming }: { offer: OfferListItem; incoming: boolean }) {
  const live = offer.status === "open" || offer.status === "countered";

  return (
    <Link
      href={`/offers/${offer.id}`}
      className="jobrow flex items-start gap-3 transition-colors hover:bg-[color:var(--paper-deep)]"
    >
      <span className="tile__img block h-14 w-14 shrink-0 overflow-hidden rounded-[2px]">
        <Media
          src={offer.listing_cover_url ?? undefined}
          alt={offer.listing_title}
          className="h-full w-full"
          fallbackClassName="plate-undrawn"
        />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <StatusChip status={offer.status} />
            <span className="order__name min-w-0 truncate">{offer.listing_title}</span>
            {offer.unread && (
              <span className="chip chip--live" aria-label="Unread messages">
                New
              </span>
            )}
          </span>
          <span className="kv shrink-0 font-medium">
            {formatPrice(offer.amount_cents)}
            {offer.counter_amount_cents && <> → {formatPrice(offer.counter_amount_cents)}</>}
          </span>
        </span>

        <span className="order__meta mt-0.5 block">
          {incoming ? `${offer.counterparty_name} makes the offer` : `To ${offer.counterparty_name}`}
          {" · "}
          {new Date(offer.created_at).toLocaleDateString()}
          {live && offer.expiresLabel && <> · {offer.expiresLabel}</>}
        </span>
      </span>
    </Link>
  );
}
