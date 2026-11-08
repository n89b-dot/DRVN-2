/**
 * Payout readiness as the database enforces it (20261107210000, N244).
 *
 * With real payments a seller can't put a listing live, or be bought from,
 * until Stripe reports their payouts enabled. The app checks first
 * (`sellerCanPublish`, ./connect.ts), and the database refuses a direct call
 * that skips it with this SQLSTATE: publishing raises it, and so does any
 * checkout path that would reserve such a seller's part (cart checkout
 * leaves the part out instead). The stub provider has no gate, and the
 * database knows that from `job_config.payments_mode = 'stub'`.
 */
export const PAYOUTS_NOT_READY_CODE = "LS001";

/** A buyer's view of that refusal at checkout or on an offer. */
export const SELLER_CANNOT_TAKE_PAYMENT_MESSAGE =
  "This seller can't take payment yet: their payouts aren't set up. Nothing was charged.";
