/**
 * Client-safe fee helpers (no server-only imports).
 */
export { formatPrice } from "@/lib/marketplace/taxonomy";
// 10% platform fee, deducted from the seller's proceeds — the buyer pays
// goods + shipping and the seller receives that minus the fee (PRD §7.4).
// Since migration 0050 the fee basis is goods subtotal + buyer-paid shipping:
// pricing value into "shipping" must not reduce DRVN's fee. The authoritative
// computation lives in SQL (purchase_begin / offer_accept_begin); this mirror
// exists for display estimates and docs. Historical orders keep the fee stored
// on the row — nothing recomputes old fees from this constant.
export const PLATFORM_FEE_BPS = 1000;

/** @param basisCents goods subtotal + buyer-paid shipping (the pre-tax total). */
export function platformFeeCents(basisCents: number): number {
  return Math.round((basisCents * PLATFORM_FEE_BPS) / 10_000);
}
