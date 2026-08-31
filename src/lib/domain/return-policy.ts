/**
 * Return/RMA policy constants (brief §27, migration 0055). Lib-level so both
 * the commerce feature and the shipping tracking layer share one source —
 * and importable by client code (the order sheet quotes the windows).
 *
 * These are applied ONCE, when a deadline is stamped onto a return row;
 * changing them later never changes an in-flight return.
 */

/** Buyer must ship an approved return within this window. */
export const RETURN_SHIP_DAYS = 7;

/** Seller inspection window once the return delivers; silence = the agreed
 *  refund proceeds. */
export const SELLER_INSPECT_HOURS = 48;
