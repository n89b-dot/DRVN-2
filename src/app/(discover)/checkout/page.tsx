import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, Media, PaymentModeNotice } from "@/components/ui";
import { loadCartSummary, loadInFlightCheckout } from "@/lib/checkout-data";
import { listSavedCards } from "@/lib/payments/customers";
import { formatPrice } from "@/lib/payments/fee";
import { paymentsAreLive } from "@/lib/payments/provider";
import { createClient } from "@/lib/supabase/server";

import { CheckoutSteps } from "./checkout-steps";

export const metadata = { title: "Checkout - DRVN" };

/**
 * P21 — secure checkout, separate from the cart. Left: shipping → payment
 * steps. Right: the persistent order summary rail. Reference pass: lululemon
 * (stepper, collapsing steps) + Etsy (secure chrome, review-at-right).
 */
export default async function CheckoutPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Submitting the shipping step reserves every listing in the basket, and a
  // server action re-renders the route it ran on — so by the time this runs
  // again mid-payment the cart legitimately holds nothing `active`. Falling
  // back to the in-flight orders keeps the buyer on the Payment Element
  // instead of bouncing them to /cart with the charge already started.
  const cart =
    (await loadCartSummary().then((summary) =>
      summary.lines.length ? summary : null
    )) ?? (await loadInFlightCheckout(user?.id ?? null));
  if (!cart?.lines.length) redirect("/cart");

  // Guests check out too — buying is the service, not an account feature.
  // Saved cards only exist for a signed-in buyer; a guest pays with the
  // Payment Element and identifies themselves with an email.
  const savedCards = user ? await listSavedCards(user.id).catch(() => []) : [];

  return (
    <div className="wrap wrap--wide pb-10">
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">Secure checkout · {cart.lines.length} part{cart.lines.length === 1 ? "" : "s"}</span>
        <h1>Nearly yours.</h1>
      </Rv>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          {/* Phone/tablet only. The desktop aside is a persistent companion to
              a form beside it; stacked, it becomes a second full order recital
              directly under CheckoutSteps' own "Review your order" block — the
              customer reads the same items and the same totals twice. So below
              `lg` the aside is dropped entirely and this takes its place: the
              total stays permanently on screen while shipping is entered, the
              full contents stay one tap away, and the authoritative final
              review remains the one inside CheckoutSteps at the payment step. */}
          <Rv className="tile tile--deep mb-4 lg:hidden">
            <details className="ordersum">
              <summary className="ordersum__line">
                <span className="min-w-0">
                  <span className="microlabel block">Order total</span>
                  <b className="ordersum__total">{formatPrice(cart.totalCents)}</b>
                </span>
                <span className="ordersum__meta">
                  {cart.lines.length} part{cart.lines.length === 1 ? "" : "s"}
                  <span className="ordersum__toggle">
                    <span className="ordersum__more">View order details</span>
                    <span className="ordersum__less">Hide order details</span>
                  </span>
                </span>
              </summary>
              <div className="ordersum__body">
                <div className="rowlist">
                  {cart.lines.map((line) => (
                    <div key={line.id} className="order">
                      <span className="min-w-0">
                        <span className="order__name block truncate">{line.title}</span>
                        <span className="order__meta block">From {line.sellerName}</span>
                      </span>
                      <span className="order__actions">
                        <b>{formatPrice(line.priceCents)}</b>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <div className="sheet__row">
                    <span>Parts</span>
                    <b>{formatPrice(cart.goodsCents)}</b>
                  </div>
                  <div className="sheet__row">
                    <span>Shipping</span>
                    <b>{cart.shippingCents > 0 ? formatPrice(cart.shippingCents) : "Free"}</b>
                  </div>
                  <div className="sheet__row sheet__total">
                    <span>You pay</span>
                    <b>{formatPrice(cart.totalCents)}</b>
                  </div>
                </div>
                {cart.sellerCount > 1 && (
                  <p className="spec-note">
                    This basket covers {cart.sellerCount} sellers, so it becomes {cart.sellerCount}{" "}
                    separate orders — one payment.
                  </p>
                )}
              </div>
            </details>
          </Rv>

          <CheckoutSteps
            idempotencyKey={randomUUID()}
            needsEmail={!user}
            allowsCollection={cart.allowsCollection}
            mixedFulfilment={cart.mixedFulfilment}
            items={cart.lines.map((line) => ({
              id: line.id,
              title: line.title,
              priceLabel: formatPrice(line.priceCents),
            }))}
            subtotalLabel={formatPrice(cart.goodsCents)}
            shippingLabel={cart.shippingCents > 0 ? formatPrice(cart.shippingCents) : "Free"}
            total={formatPrice(cart.totalCents)}
            savedCards={savedCards}
          />

          {/* The payment-mode notice and the terms/fees line live in the aside
              on desktop. Dropping the aside on a phone must not drop them —
              they belong beside the act of paying, so on mobile they follow
              the journey instead of preceding it. */}
          <div className="mt-4 lg:hidden">
            <PaymentModeNotice live={paymentsAreLive()} />
            <p className="field__hint mt-3">
              By placing this order you agree to DRVN&apos;s{" "}
              <Link href="/terms" className="jumplink">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/fees" className="jumplink">
                Fees
              </Link>
              .
            </p>
          </div>
        </div>

        <aside className="max-lg:hidden">
          <Rv className="tile tile--deep lg:sticky lg:top-20">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Order summary</span>
            </div>
            <div className="rowlist">
              {cart.lines.map((line) => (
                <div key={line.id} className="order">
                  <span className="order__img">
                    <Media src={line.coverUrl ?? undefined} alt={line.title} className="h-full w-full" role="row" />
                  </span>
                  <span className="min-w-0">
                    <span className="order__name block truncate">{line.title}</span>
                    <span className="order__meta block">From {line.sellerName}</span>
                  </span>
                  <span className="order__actions">
                    <b>{formatPrice(line.priceCents)}</b>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <div className="sheet__row">
                <span>Parts</span>
                <b>{formatPrice(cart.goodsCents)}</b>
              </div>
              <div className="sheet__row">
                <span>Shipping</span>
                <b>{cart.shippingCents > 0 ? formatPrice(cart.shippingCents) : "Free"}</b>
              </div>
              <div className="sheet__row sheet__total">
                <span>You pay</span>
                <b>{formatPrice(cart.totalCents)}</b>
              </div>
            </div>
            {cart.sellerCount > 1 && (
              <p className="spec-note">
                This basket covers {cart.sellerCount} sellers, so it becomes {cart.sellerCount}{" "}
                separate orders — one payment.
              </p>
            )}
            <PaymentModeNotice live={paymentsAreLive()} />
            <p className="field__hint mt-3">
              By placing this order you agree to DRVN&apos;s{" "}
              <Link href="/terms" className="jumplink">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/fees" className="jumplink">
                Fees
              </Link>
              .
            </p>
          </Rv>
        </aside>
      </div>

      <Foot left="DRVN — nothing is charged until you confirm" right={<Link href="/cart">← Back to cart</Link>} />
    </div>
  );
}
