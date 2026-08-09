/**
 * Offers-surface entry point for the commerce actions the offer list and
 * thread pages call. These are plain re-exports — the actual logic (and its
 * validation, RLS-safe admin client usage, and `/offers` revalidation) lives
 * in features/commerce/actions.ts, which every one of these already
 * revalidates `/offers` and `/offers/[id]` from. Kept as a named surface so
 * offers/** imports read as "this page's actions" rather than reaching
 * across into commerce internals, and so a future offers-only action (e.g.
 * a dedicated "mark thread read" entry point) has an obvious home.
 */
export {
  respondToOffer,
  withdrawOffer,
  acceptCounter,
  sendThreadMessage,
  markThreadMessagesRead,
  type CommerceState,
} from "@/features/commerce/actions";
