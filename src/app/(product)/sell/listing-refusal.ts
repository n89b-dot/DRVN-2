import {
  CHARGE_OUT_OF_BOUNDS_CODE,
  LISTING_PRICE_OUT_OF_BOUNDS_MESSAGE,
} from "@/lib/payments/charge-bounds";
import { PAYOUTS_NOT_READY_CODE } from "@/lib/payments/payout-readiness";

export const PHOTO_REQUIRED =
  "Add at least one photo before publishing — a listing goes public with its picture. Drafts can save without one.";

/** listings_shipping_bounds (0007): the most a listing may charge to ship. */
export const MAX_SHIPPING_CENTS = 10_000_000;

export const PAYOUTS_REQUIRED =
  "Publishing needs payouts set up first (Selling → Payouts), so a sale has somewhere to send your money. You can still save this as a draft.";

/**
 * The database's refusals of a listing write, in the seller's words. Since
 * 20261107210000 the rules the sell form checks are held there too, so a
 * write the form let through (or one made around it) is refused with a code:
 * LS001 payouts aren't set up, 23514 a live listing needs a photo, 54000 too
 * many photos or fitment rows, 55000 the listing is held or sold. Null for
 * anything else, which the caller reports.
 */
export function listingWriteRefusal(code: string | undefined): string | null {
  switch (code) {
    case PAYOUTS_NOT_READY_CODE:
      return PAYOUTS_REQUIRED;
    case "23514":
      return PHOTO_REQUIRED;
    case "54000":
      return "That's more than a listing holds: up to 12 photos, 10 fitment rows and 5 part numbers.";
    case "55000":
      return "A sold or reserved part can't be edited.";
    case CHARGE_OUT_OF_BOUNDS_CODE:
      return LISTING_PRICE_OUT_OF_BOUNDS_MESSAGE;
    case "42501":
      return "This account can't publish listings right now.";
    default:
      return null;
  }
}
