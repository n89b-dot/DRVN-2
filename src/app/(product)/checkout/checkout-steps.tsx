"use client";

import { useActionState, useId, useState } from "react";

import { checkoutCart, type CommerceState } from "@/features/commerce/actions";
import type { SavedCard } from "@/lib/payments/customers";

import { PaymentConfirm } from "../cart/payment-confirm";
import { SavedCardPay } from "./saved-card-pay";

/**
 * P21 — the checkout, lululemon-shaped: 1 Shipping → 2 Payment, a completed
 * step collapsing to a summary line with a Change link. The address submit is
 * what creates the orders + PaymentIntent (idempotent, so Change → resubmit
 * replays the same orders with updated details rather than duplicating).
 */
export function CheckoutSteps({
  idempotencyKey,
  allowsCollection,
  total,
  savedCards,
  action = checkoutCart,
  orderId,
}: {
  idempotencyKey: string;
  allowsCollection: boolean;
  total: string;
  savedCards: SavedCard[];
  /** Defaults to cart checkout; a reserved order passes its own action. */
  action?: (prev: CommerceState, formData: FormData) => Promise<CommerceState>;
  orderId?: string;
}) {
  const [state, formAction, pending] = useActionState<CommerceState, FormData>(action, {});
  const [collection, setCollection] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [address, setAddress] = useState<{ name: string; line1: string; city: string } | null>(
    null
  );
  const errorId = useId();

  const paymentStep = Boolean(state.payment) && !editingAddress;

  return (
    <div className="grid gap-4">
      <span className="microlabel">
        <span className={paymentStep ? "" : "microlabel--ink"}>1 Shipping</span>
        {" · "}
        <span className={paymentStep ? "microlabel--ink" : ""}>2 Payment</span>
      </span>

      {paymentStep ? (
        <>
          <div className="tile">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className="microlabel microlabel--ink block">Shipping</span>
                <span className="order__meta block truncate">
                  {address
                    ? [address.name, address.line1, address.city].filter(Boolean).join(", ")
                    : collection
                      ? "Collecting in person"
                      : "Address saved"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setEditingAddress(true)}
                className="jumplink shrink-0"
              >
                Change
              </button>
            </div>
          </div>

          <div className="tile">
            {savedCards.length > 0 && state.payment ? (
              <SavedCardPay
                savedCards={savedCards}
                clientSecret={state.payment.clientSecret}
                orderIds={state.payment.orderIds}
                total={total}
              />
            ) : (
              state.payment && (
                <PaymentConfirm
                  clientSecret={state.payment.clientSecret}
                  orderIds={state.payment.orderIds}
                  total={total}
                  canSaveCard
                />
              )
            )}
          </div>
        </>
      ) : (
        <form
          action={(fd) => {
            setAddress({
              name: String(fd.get("ship_name") ?? ""),
              line1: String(fd.get("ship_line1") ?? ""),
              city: String(fd.get("ship_city") ?? ""),
            });
            setEditingAddress(false);
            formAction(fd);
          }}
          className="tile grid gap-4"
        >
          <input type="hidden" name="idempotency_key" value={idempotencyKey} />
          {orderId && <input type="hidden" name="order_id" value={orderId} />}

          {allowsCollection && (
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                name="is_collection"
                checked={collection}
                onChange={(event) => setCollection(event.target.checked)}
                className="accent-live"
              />
              Collecting in person — no delivery address needed
            </label>
          )}

          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="microlabel microlabel--ink mb-1">
              {collection ? "Who's collecting" : "Where it ships"}
            </legend>

            <label className="field">
              <span className="field__label">Name</span>
              <input name="ship_name" className="ctl !max-w-none" required autoComplete="name" />
            </label>

            {!collection && (
              <>
                <label className="field">
                  <span className="field__label">Address</span>
                  <input
                    name="ship_line1"
                    className="ctl !max-w-none"
                    required
                    autoComplete="address-line1"
                  />
                </label>
                <label className="field">
                  <span className="field__label">Address line 2 (optional)</span>
                  <input
                    name="ship_line2"
                    className="ctl !max-w-none"
                    autoComplete="address-line2"
                  />
                </label>
                <div className="field--row">
                  <label className="field">
                    <span className="field__label">City</span>
                    <input
                      name="ship_city"
                      className="ctl !max-w-none"
                      required
                      autoComplete="address-level2"
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Postcode</span>
                    <input
                      name="ship_postcode"
                      className="ctl !max-w-none"
                      required
                      autoComplete="postal-code"
                    />
                  </label>
                </div>
                <label className="field">
                  <span className="field__label">Country</span>
                  <input
                    name="ship_country"
                    className="ctl !max-w-none"
                    required
                    autoComplete="country-name"
                  />
                </label>
              </>
            )}

            <label className="field">
              <span className="field__label">Phone (optional)</span>
              <input name="ship_phone" className="ctl !max-w-none" autoComplete="tel" />
            </label>
          </fieldset>

          <button type="submit" disabled={pending} className="btn btn--live w-full">
            {pending ? "Saving…" : "Continue to payment"}
          </button>

          <p
            id={errorId}
            role="alert"
            aria-live="polite"
            className={state.error ? "field__err" : "sr-only"}
          >
            {state.error ?? ""}
          </p>
        </form>
      )}
    </div>
  );
}
