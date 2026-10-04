/** The parts of a Stripe.js `confirmSetup` error this page acts on. */
export type SetupError = {
  code?: string;
  setup_intent?: { status?: string } | null;
};

/**
 * A retry after a lost answer can find the card already saved: the first
 * attempt reached Stripe, the browser never heard back. Stripe then refuses
 * to confirm again (`setup_intent_unexpected_state`). The card is on the
 * account, so treat it as saved rather than show the refusal as a failure.
 */
export function setupAlreadySaved(error: SetupError): boolean {
  return error.code === "setup_intent_unexpected_state" && error.setup_intent?.status === "succeeded";
}
