/**
 * OS-W17 (N482): why a checkout sent the buyer back to /cart.
 *
 * The payment return route used to redirect with free text in `?error=`,
 * and the cart page never read it, so the buyer landed on their cart with
 * no idea the payment hadn't gone through. Redirects now carry a short code,
 * and the cart renders the message for it. Codes rather than text, so the
 * URL can't be used to put arbitrary words on a DRVN page.
 */
export const CART_ERROR = {
  paymentUnverified: "payment-unverified",
  paymentFailed: "payment-failed",
} as const;

export type CartErrorCode = (typeof CART_ERROR)[keyof typeof CART_ERROR];

const MESSAGES: Record<CartErrorCode, { title: string; body: string }> = {
  "payment-unverified": {
    title: "We couldn't match that payment to your checkout",
    body: "Nothing in your cart has been marked as paid. Check your orders before paying again; if a charge appears without an order, contact support with the order reference.",
  },
  "payment-failed": {
    title: "Payment didn't go through",
    body: "Your card wasn't charged for this checkout. Check the card details, then check out again.",
  },
};

const FALLBACK = {
  title: "That checkout didn't finish",
  body: "Check your orders before trying again, so nothing is paid for twice.",
};

/** The message for `?error=`, or null when there's no error to show. */
export function cartErrorMessage(code: string | string[] | undefined): { title: string; body: string } | null {
  const value = Array.isArray(code) ? code[0] : code;
  if (!value) return null;
  return (MESSAGES as Record<string, { title: string; body: string }>)[value] ?? FALLBACK;
}
