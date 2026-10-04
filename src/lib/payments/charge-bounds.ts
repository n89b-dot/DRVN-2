/**
 * What one card charge can be, in cents. Stripe refuses a USD charge under
 * $0.50 or over $999,999.99, so a listing, an accepted offer or a basket
 * outside these bounds could be reserved but never paid for. The database
 * holds the same numbers (charge_cents_in_bounds, 20261004130000) and refuses
 * with SQLSTATE 22003; these mirror them so the app can say so first.
 */
export const MIN_CHARGE_CENTS = 50;
export const MAX_CHARGE_CENTS = 99_999_999;

/** The database's refusal of an out-of-bounds amount. */
export const CHARGE_OUT_OF_BOUNDS_CODE = "22003";

export function chargeWithinBounds(cents: number): boolean {
  return Number.isInteger(cents) && cents >= MIN_CHARGE_CENTS && cents <= MAX_CHARGE_CENTS;
}

export const CHECKOUT_OUT_OF_BOUNDS_MESSAGE =
  "Card payments must come to between $0.50 and $999,999.99. Adjust your basket and try again — nothing was charged.";

export const LISTING_PRICE_OUT_OF_BOUNDS_MESSAGE =
  "A listed part needs a price between $0.50 and $999,999.99. Save it as a draft to keep working on the price.";

export const OFFER_OUT_OF_BOUNDS_MESSAGE =
  "With shipping, this offer comes to less than $0.50 or more than $999,999.99 — a card can't be charged that amount.";
