export type CommerceState = {
  error?: string;
  ok?: string;
  /** Client-generated identity for retryable form submissions such as Q&A. */
  operationId?: string;
  /** Where to go next, e.g. the conversation a "Message seller" landed in. */
  href?: string;
  /** Set when the processor needs the buyer to confirm in the browser
   *  (Stripe Payment Element). The form swaps to the confirmation step. */
  payment?: CheckoutPayment;
};

/** The payment the server created. `amountCents` is what will be charged —
 *  the only total a checkout shows once it exists (RR-10). */
export type CheckoutPayment = { clientSecret: string; orderIds: string[]; amountCents: number };

export type CheckoutOutcome = {
  error?: string;
  orderIds: string[];
  purchased: { listingId: string; title: string }[];
  skipped: { listingId: string; title: string; reason: string }[];
  /** Async processor: the buyer still has to confirm in the browser. Orders
   *  stay pending and listings reserved until the webhook settles them. */
  payment?: CheckoutPayment;
};

export type ShippingDetails = {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  postcode: string;
  /** ISO 3166-1 alpha-2 code on new orders; see src/lib/geo/countries.ts. */
  country: string;
  /** State / province / region — optional except client-side for US/CA/AU. */
  state: string | null;
  phone: string | null;
  isCollection: boolean;
};
