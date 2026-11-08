/**
 * Payout setup as the database enforces it (20261108100000, N244; Neil's
 * ruling 8 Nov 2026, docs/decisions/seller-payout-setup.md).
 *
 * With real payments a seller can put a listing live, and be bought from,
 * once their Stripe setup has *started*: they have submitted their details,
 * even if Stripe is still verifying them. The payout itself waits until
 * Stripe reports payouts enabled (the transfer worker's blocked_unpayable).
 * Fourteen days after a sale with payouts still off, the seller is
 * restricted: their live listings are paused, an order they haven't
 * dispatched is cancelled and refunded in full (./payout-deadline.ts), and
 * they can't publish or sell until payouts are enabled.
 *
 * The app checks first (`sellerCanPublish`, ./connect.ts), and the database
 * refuses a direct call that skips it with PAYOUTS_NOT_READY_CODE:
 * publishing raises it, and so does any checkout path that would reserve
 * such a seller's part (cart checkout leaves the part out instead). The stub
 * provider has no gate, and the database knows that from
 * `job_config.payments_mode = 'stub'`.
 */
export const PAYOUTS_NOT_READY_CODE = "LS001";

/** Dispatch refused: the order is being cancelled by the payout deadline. */
export const PAYOUT_DEADLINE_CODE = "LS002";

/** Days after a sale before the deadline acts (claim_payout_deadline_cancellations). */
export const PAYOUT_SETUP_DEADLINE_DAYS = 14;

/** A buyer's view of that refusal at checkout or on an offer. */
export const SELLER_CANNOT_TAKE_PAYMENT_MESSAGE =
  "This seller can't take payment yet: their payouts aren't set up. Nothing was charged.";

/**
 * Where a seller's payout setup stands, from the stored Stripe state:
 *  - not_started: no connected account, or details not submitted;
 *  - verifying: details submitted, Stripe hasn't enabled payouts yet;
 *  - enabled: Stripe reports payouts enabled;
 *  - restricted: a sale passed the deadline before payouts were enabled.
 * The same order as private.seller_can_take_payment: enabled wins.
 */
export type PayoutSetupState = "not_started" | "verifying" | "enabled" | "restricted";

export type StoredPayoutSetup = {
  accountId: string | null;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  restricted: boolean;
};

export function payoutSetupState(setup: StoredPayoutSetup): PayoutSetupState {
  if (setup.payoutsEnabled) return "enabled";
  if (setup.restricted) return "restricted";
  if (setup.accountId && setup.detailsSubmitted) return "verifying";
  return "not_started";
}

/** Whether a seller in this state can publish and be bought from. */
export function canTakeSales(state: PayoutSetupState): boolean {
  return state === "enabled" || state === "verifying";
}
