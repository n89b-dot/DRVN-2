import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { ButtonLink, EmptyState, Foot, ObjectRow, PaymentModeNotice } from "@/components/ui";
import { getBetaAccess } from "@/lib/beta-access";
import { loadCartSummary, loadInFlightCheckout } from "@/lib/checkout-data";
import { listSavedCards } from "@/lib/payments/customers";
import { formatPrice } from "@/lib/payments/fee";
import { paymentsAreLive } from "@/lib/payments/provider";
import { createClient } from "@/lib/supabase/server";

import { CheckoutSteps } from "./checkout-steps";
import { CheckoutHeadlineTotal, CheckoutTotalRows, CheckoutTotalsProvider } from "./checkout-totals-context";

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
  const betaAccess = await getBetaAccess(user?.id, "buyer");
  if (betaAccess.unavailable) {
    // The check failed — not a "no". Still no checkout, but the buyer is
    // told to try again rather than that they aren't invited.
    return (
      <div className="wrap pb-10">
        <EmptyState
          mark="!"
          title="We couldn't check your checkout access"
          action={<ButtonLink href="/checkout">Try again</ButtonLink>}
        >
          Something went wrong on our side, so checkout is paused for a moment. Nothing new has been
          charged.
        </EmptyState>
      </div>
    );
  }
  if (betaAccess.enforced && !user) redirect("/login?next=%2Fcheckout");
  if (!betaAccess.eligible) {
    return (
      <div className="wrap pb-10">
        <EmptyState
          mark="β"
          title="Checkout is limited to invited members"
          action={<ButtonLink href="/marketplace">Back to the marketplace</ButtonLink>}
        >
          Your account can still browse DRVN and access existing orders. New purchases require an active beta membership.
        </EmptyState>
      </div>
    );
  }

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

  // Guest checkout remains available outside the controlled-beta rollout.
  const savedCards = user ? await listSavedCards(user.id).catch(() => []) : [];

  return (
    <div className="wrap wrap--wide pb-10">
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">Secure checkout · {cart.lines.length} part{cart.lines.length === 1 ? "" : "s"}</span>
        <h1>Nearly yours.</h1>
      </Rv>

      <CheckoutTotalsProvider
        base={{ goodsCents: cart.goodsCents, flatShippingCents: cart.shippingCents, quotedLines: cart.drvnLines.length }}
      >
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
                  <CheckoutHeadlineTotal className="ordersum__total" />
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
                    <ObjectRow key={line.id} actions={<b>{formatPrice(line.priceCents)}</b>}>
                      <span className="min-w-0">
                        <span className="order__name block truncate">{line.title}</span>
                        <span className="order__meta block">From {line.sellerName}</span>
                      </span>
                    </ObjectRow>
                  ))}
                </div>
                <div className="mt-3">
                  <CheckoutTotalRows goodsCents={cart.goodsCents} />
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
            total={formatPrice(cart.totalCents)}
            savedCards={savedCards}
            drvnListings={cart.drvnLines}
            totalsBase={{ goodsCents: cart.goodsCents, flatShippingCents: cart.shippingCents }}
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
                <ObjectRow
                  key={line.id}
                  media={{ src: line.coverUrl ?? undefined, alt: line.title }}
                  actions={<b>{formatPrice(line.priceCents)}</b>}
                >
                  <span className="min-w-0">
                    <span className="order__name block truncate">{line.title}</span>
                    <span className="order__meta block">From {line.sellerName}</span>
                  </span>
                </ObjectRow>
              ))}
            </div>
            <div className="mt-3">
              <CheckoutTotalRows goodsCents={cart.goodsCents} />
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
      </CheckoutTotalsProvider>

      <Foot left="DRVN — nothing is charged until you confirm" right={<Link href="/cart">← Back to cart</Link>} />
    </div>
  );
}
