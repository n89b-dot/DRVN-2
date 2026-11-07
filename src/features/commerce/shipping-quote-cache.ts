import type { QuoteOption } from "./shipping-quote-actions";

/**
 * Reuse of stored DRVN Shipping quotes (N96). Kept out of the "use server"
 * module so it stays a plain, testable function.
 */

export const MAX_RATES_PER_LINE = 4;

export type Parcel = { weightOz: number; lengthIn: number; widthIn: number; heightIn: number };

export type StoredQuote = {
  id: string;
  service_label: string;
  amount_cents: number;
  est_delivery_days: number | null;
  provider_shipment_id: string;
  parcel: unknown;
  created_at: string;
};

function sameParcel(stored: unknown, parcel: Parcel): boolean {
  if (!stored || typeof stored !== "object") return false;
  const p = stored as Record<string, unknown>;
  return (
    Number(p.weightOz) === parcel.weightOz &&
    Number(p.lengthIn) === parcel.lengthIn &&
    Number(p.widthIn) === parcel.widthIn &&
    Number(p.heightIn) === parcel.heightIn
  );
}

/**
 * The newest still-valid set of rates for this line, buyer and destination,
 * or null. Reuse is free: no provider call, no new rows (N96). A quote that
 * was consumed by an order, belongs to someone else, or would expire before
 * the buyer could reasonably pay is never offered again.
 */
export function reusableQuoteSet(rows: StoredQuote[], parcel: Parcel): QuoteOption[] | null {
  const valid = rows.filter((row) => sameParcel(row.parcel, parcel));
  if (!valid.length) return null;
  const newest = valid.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
  const set = valid
    .filter((row) => row.provider_shipment_id === newest.provider_shipment_id)
    .sort((a, b) => a.amount_cents - b.amount_cents)
    .slice(0, MAX_RATES_PER_LINE);
  return set.map((q) => ({
    quoteId: q.id,
    serviceLabel: q.service_label,
    amountCents: q.amount_cents,
    estDeliveryDays: q.est_delivery_days,
  }));
}
