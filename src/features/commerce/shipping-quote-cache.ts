import { createHash } from "node:crypto";

import type { ShippingAddress } from "@/lib/shipping/types";

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
  request_fingerprint: string | null;
  created_at: string;
};

/** JSON with sorted keys and undefined as null, so equal inputs hash equally. */
function canonical(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Everything the provider shipment behind a quote was created from: the
 * provider, both full addresses (every field — apartment, recipient, state,
 * phone…), the seller's postage identity and the parcel. A stored quote is
 * reused only when this matches exactly, because a later label buy uses the
 * quote's provider shipment as it was created (Codex review of #82): a
 * changed apartment or ship-from must never print the old one.
 */
export function quoteRequestFingerprint(input: {
  provider: string;
  from: ShippingAddress;
  to: ShippingAddress;
  parcel: Parcel;
  endShipperRef: string | null;
}): string {
  const address = (a: ShippingAddress) => ({
    name: a.name,
    company: a.company ?? null,
    street1: a.street1,
    street2: a.street2 ?? null,
    city: a.city,
    state: a.state ?? null,
    postalCode: a.postalCode,
    country: a.country,
    phone: a.phone ?? null,
    email: a.email ?? null,
  });
  return createHash("sha256")
    .update(
      canonical({
        v: 1,
        provider: input.provider,
        from: address(input.from),
        to: address(input.to),
        endShipperRef: input.endShipperRef,
        parcel: input.parcel,
      }),
      "utf8",
    )
    .digest("hex");
}

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
 * The newest still-valid set of rates for exactly this shipment request
 * (fingerprint) and buyer, or null. Reuse is free: no provider call, no new rows (N96). A quote that
 * was consumed by an order, belongs to someone else, or would expire before
 * the buyer could reasonably pay is never offered again.
 */
export function reusableQuoteSet(rows: StoredQuote[], parcel: Parcel, fingerprint: string): QuoteOption[] | null {
  const valid = rows.filter((row) => row.request_fingerprint === fingerprint && sameParcel(row.parcel, parcel));
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
