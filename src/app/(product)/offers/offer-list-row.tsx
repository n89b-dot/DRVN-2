import { ObjectRow } from "@/components/ui";
import { cx } from "@/lib/format";
import { formatPrice } from "@/lib/marketplace/taxonomy";

import { StatusChip } from "@/components/commerce";

export type OfferListItem = {
  id: string;
  listing_id: string;
  listing_title: string;
  listing_cover_url: string | null;
  /** The listing's asking price — the number an offer is read against. */
  asking_cents: number | null;
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
 * One row of the /offers list, on the shared dense row (ObjectRow).
 *
 * Ordered by what a decision actually needs: whether it's waiting on you,
 * then the part, then the money *against the asking price* (the number a
 * seller actually decides on), then who and by when. Status sits quietly at
 * the end — the flag already said what matters. One flag, not three chips.
 */
export function OfferListRow({ offer, incoming }: { offer: OfferListItem; incoming: boolean }) {
  const live = offer.status === "open" || offer.status === "countered";
  const flag = offer.needsYou
    ? offer.unread
      ? "Needs you · new message"
      : "Needs you"
    : offer.unread
      ? "New message"
      : null;
  const latest = offer.counter_amount_cents ?? offer.amount_cents;
  const gap =
    offer.asking_cents && offer.asking_cents > 0
      ? Math.round(((latest - offer.asking_cents) / offer.asking_cents) * 100)
      : null;

  return (
    <ObjectRow
      href={`/offers/${offer.id}`}
      media={{ src: offer.listing_cover_url ?? undefined, alt: offer.listing_title }}
      className={cx("offerrow order--under", offer.needsYou && "offerrow--needs")}
      actions={<StatusChip status={offer.status} />}
    >
      <span className="min-w-0">
        {flag && (
          <span className="offerrow__flags">
            <span className="chip chip--live">{flag}</span>
          </span>
        )}
        <span className="order__name block truncate">{offer.listing_title}</span>
        <span className="kv mt-0.5 block font-medium">
          {formatPrice(offer.amount_cents)}
          {offer.counter_amount_cents !== null && <> → {formatPrice(offer.counter_amount_cents)}</>}
          {offer.asking_cents !== null && (
            <span className="font-normal text-dim">
              {" "}
              on {formatPrice(offer.asking_cents)}
              {gap !== null && gap !== 0 && <> · {gap > 0 ? `+${gap}` : `−${Math.abs(gap)}`}%</>}
            </span>
          )}
        </span>
        <span className="order__meta mt-0.5 block">
          {incoming ? `${offer.counterparty_name} offered` : `To ${offer.counterparty_name}`}
          {" · "}
          {new Date(offer.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          {live && offer.expiresLabel && <> · {offer.expiresLabel}</>}
        </span>
      </span>
    </ObjectRow>
  );
}
