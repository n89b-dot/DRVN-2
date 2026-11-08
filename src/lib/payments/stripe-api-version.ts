import type Stripe from "stripe";

/**
 * The one Stripe API version DRVN speaks (readiness N144). Every request the
 * shared client makes (`stripe.ts`) sends it explicitly, so an SDK upgrade can
 * no longer change the shape of the objects the money code reads without
 * someone changing this line on purpose.
 *
 * The type is the SDK's own latest version, so `npm install stripe@next`
 * fails `tsc` here until the pin is moved deliberately. Moving it means
 * reading Stripe's changelog for every version in between, updating the
 * webhook fixtures in `stripe-api-version.test.ts`, and re-running
 * `scripts/owner/stripe-webhooks.mjs` (which creates endpoints on this same
 * version and warns about any endpoint on another one: an endpoint's version
 * decides the shape of the events it delivers).
 *
 * 2026-07-29.dahlia — what this matters for: a Charge carries no `refunds`
 * list (removed in 2022-11-15), so `charge.refunded` enumerates refunds with
 * `refunds.list({ charge })` (settlement.ts).
 */
export const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2026-07-29.dahlia";
