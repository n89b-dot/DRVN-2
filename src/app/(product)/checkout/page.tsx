import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, Media, PaymentModeNotice } from "@/components/ui";
import { loadCartSummary } from "@/lib/checkout-data";
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
  if (!user) redirect("/login?next=/checkout");

  const cart = await loadCartSummary();
  if (!cart.lines.length) redirect("/cart");

  const savedCards = await listSavedCards(user.id).catch(() => []);

  return (
    <div className="mx-auto w-full max-w-[1060px] px-5 pb-10">
      <Rv as="header" className="pagehead">
        <span className="microlabel">Secure checkout · {cart.lines.length} part{cart.lines.length === 1 ? "" : "s"}</span>
        <h1>Nearly yours.</h1>
      </Rv>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <CheckoutSteps
            idempotencyKey={randomUUID()}
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
        </div>

        <aside>
          <Rv className="tile tile--deep lg:sticky lg:top-20">
            <span className="microlabel microlabel--ink">Order summary</span>
            <div className="rowlist mt-2">
              {cart.lines.map((line) => (
                <div key={line.id} className="order">
                  <span className="order__img">
                    <Media src={line.coverUrl ?? undefined} alt={line.title} className="h-full w-full" />
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
