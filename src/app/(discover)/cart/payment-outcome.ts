/** The parts of a Stripe.js confirmation error this page acts on. */
export type ConfirmError = {
  code?: string;
  message?: string;
  payment_intent?: { status?: string } | null;
};

/**
 * What to do when `stripe.confirmPayment` answers with an error instead of
 * leaving for the return URL.
 *
 * A retry after a lost answer can find the payment already taken: the first
 * attempt reached Stripe, the browser never heard back. Stripe then refuses to
 * confirm again (`payment_intent_unexpected_state`) — the buyer has paid, so
 * send them to /cart/complete to verify it rather than show the refusal as a
 * failure. Anything else is a real decline the buyer can act on.
 */
export function afterConfirmError(
  error: ConfirmError,
): { verify: true } | { verify: false; message: string } {
  const status = error.payment_intent?.status;
  if (
    error.code === "payment_intent_unexpected_state" &&
    (status === "succeeded" || status === "processing" || status === "requires_capture")
  ) {
    return { verify: true };
  }
  return { verify: false, message: error.message ?? "Payment failed. Try another card." };
}

/** /cart/complete verifies the intent server-side; Stripe adds this parameter
 *  itself on its own redirect, so a page-initiated visit adds it too. */
export function completeUrl(origin: string, orderIds: string[], reference?: string) {
  const url = new URL("/cart/complete", origin);
  url.searchParams.set("orders", orderIds.join(","));
  if (reference) url.searchParams.set("payment_intent", reference);
  return url.toString();
}
