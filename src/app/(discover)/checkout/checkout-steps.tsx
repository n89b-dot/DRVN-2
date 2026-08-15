"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";

import { checkoutCart, type CommerceState } from "@/features/commerce/actions";
import type { SavedCard } from "@/lib/payments/customers";
import { COUNTRIES, DEFAULT_COUNTRY_CODE, countryLabel } from "@/lib/geo/countries";

import { PaymentConfirm } from "../cart/payment-confirm";
import { SavedCardPay } from "./saved-card-pay";

/** One line of the order-summary review, shown again before payment so the
 *  buyer sees items + total together, not just an address confirmation. */
export type ReviewItem = { id: string; title: string; priceLabel: string };

/** Countries where a state/province/region is expected for delivery. */
const STATE_REQUIRED_COUNTRIES = new Set(["US", "CA", "AU"]);

type Address = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  postcode: string;
  country: string;
  state: string;
  phone: string;
};

const BLANK_ADDRESS: Address = {
  name: "",
  line1: "",
  line2: "",
  city: "",
  postcode: "",
  country: DEFAULT_COUNTRY_CODE,
  state: "",
  phone: "",
};

/**
 * P21 — the checkout, lululemon-shaped: 1 Shipping → 2 Payment, a completed
 * step collapsing to a summary line with a Change link. The address submit is
 * what creates the orders + PaymentIntent (idempotent, so Change → resubmit
 * replays the same orders with updated details rather than duplicating).
 */
export function CheckoutSteps({
  idempotencyKey,
  needsEmail = false,
  allowsCollection,
  mixedFulfilment = false,
  items,
  subtotalLabel,
  shippingLabel,
  total,
  savedCards,
  action = checkoutCart,
  orderId,
}: {
  idempotencyKey: string;
  /** Signed-out checkout: collect the email the order confirmation goes to. */
  needsEmail?: boolean;
  allowsCollection: boolean;
  /** Basket mixes collection-capable and shipping-only listings, so the
   *  single is_collection flag can't cover it — explain why the checkbox
   *  below isn't offered instead of just omitting it. */
  mixedFulfilment?: boolean;
  /** Line items for the pre-payment review — optional so callers that don't
   *  have a full cart breakdown (e.g. a single reserved order) still work. */
  items?: ReviewItem[];
  subtotalLabel?: string;
  shippingLabel?: string;
  total: string;
  savedCards: SavedCard[];
  /** Defaults to cart checkout; a reserved order passes its own action. */
  action?: (prev: CommerceState, formData: FormData) => Promise<CommerceState>;
  orderId?: string;
}) {
  const [state, formAction, pending] = useActionState<CommerceState, FormData>(action, {});
  const [collection, setCollection] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  // Kept in state (not just read at submit time) so "Change" re-renders the
  // form pre-filled via defaultValue/value below, instead of resetting it —
  // the old version only remembered {name, line1, city} and lost everything
  // else on every edit.
  const [address, setAddress] = useState<Address>(BLANK_ADDRESS);
  // Held in state for the same reason the address is: "Change" must re-render
  // the form filled in, not blank.
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);
  const errorId = useId();

  const stateRequired = STATE_REQUIRED_COUNTRIES.has(address.country);
  const paymentStep = Boolean(state.payment) && !editingAddress;

  // The address is only fully readable once "Change" has been through the
  // form at least once (saved) — before that, and while collecting in
  // person, there's nothing to format as a delivery address.
  const addressLines = [
    address.line1,
    address.line2,
    [address.city, address.state].filter(Boolean).join(" "),
    address.postcode,
    countryLabel(address.country),
  ].filter(Boolean);

  return (
    <div className="grid gap-4">
      {/* The system's documented step recipe (auto-numbered 01/02, live
          numeral on the current step) — checkout previously hand-rolled a
          dot-separated microlabel list while `.steps` had zero call sites. */}
      <ol className="steps list-none p-0 m-0" aria-label="Checkout progress">
        <li
          className={`step ${paymentStep ? "is-done" : "is-now"}`}
          aria-current={paymentStep ? undefined : "step"}
        >
          <span className="step__n" aria-hidden="true" />
          <span className="step__t">Shipping</span>
          {paymentStep && <span className="chip chip--ok">Done</span>}
        </li>
        <li className={`step ${paymentStep ? "is-now" : ""}`} aria-current={paymentStep ? "step" : undefined}>
          <span className="step__n" aria-hidden="true" />
          <span className="step__t">Payment</span>
        </li>
      </ol>

      {paymentStep ? (
        <>
          <div className="tile">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className="microlabel microlabel--ink block">Shipping</span>
                <span className="order__meta block truncate">
                  {collection
                    ? "Collecting in person"
                    : saved
                      ? [address.name, address.line1, address.city].filter(Boolean).join(", ")
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

          {/* Final review — items, fulfilment, full address, and the total
              breakdown together, immediately before the payment element, so
              the buyer sees the whole commitment in one place before paying. */}
          <div className="tile grid gap-3">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Review your order</span>
              <Link href="/cart" className="jumplink shrink-0">
                Change
              </Link>
            </div>

            {items && items.length > 0 && (
              <div className="rowlist">
                {items.map((item) => (
                  <div key={item.id} className="flex items-baseline justify-between gap-3">
                    <span className="order__name min-w-0 truncate">{item.title}</span>
                    <b className="shrink-0">{item.priceLabel}</b>
                  </div>
                ))}
              </div>
            )}

            {needsEmail && email && (
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="field__label block">Confirmation to</span>
                  <span className="order__meta block truncate">{email}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setEditingAddress(true)}
                  className="jumplink shrink-0"
                >
                  Change
                </button>
              </div>
            )}

            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="field__label block">
                  {collection ? "Collection" : "Delivery address"}
                </span>
                <span className="order__meta block">
                  {collection ? (
                    "Collecting in person — no delivery address needed"
                  ) : saved && addressLines.length ? (
                    <>
                      {address.name}
                      <br />
                      {addressLines.join(", ")}
                    </>
                  ) : (
                    "Address saved"
                  )}
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

            {(subtotalLabel || shippingLabel) && (
              <div>
                {subtotalLabel && (
                  <div className="sheet__row">
                    <span>Subtotal</span>
                    <b>{subtotalLabel}</b>
                  </div>
                )}
                {!collection && shippingLabel && (
                  <div className="sheet__row">
                    <span>Shipping</span>
                    <b>{shippingLabel}</b>
                  </div>
                )}
                <div className="sheet__row sheet__total">
                  <span>Total</span>
                  <b>{total}</b>
                </div>
              </div>
            )}
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
            // Every field, not just the three the summary line shows — so
            // pressing Change again re-renders the form fully pre-filled
            // instead of blank.
            setAddress({
              name: String(fd.get("ship_name") ?? ""),
              line1: String(fd.get("ship_line1") ?? ""),
              line2: String(fd.get("ship_line2") ?? ""),
              city: String(fd.get("ship_city") ?? ""),
              postcode: String(fd.get("ship_postcode") ?? ""),
              country: String(fd.get("ship_country") ?? DEFAULT_COUNTRY_CODE),
              state: String(fd.get("ship_state") ?? ""),
              phone: String(fd.get("ship_phone") ?? ""),
            });
            if (needsEmail) setEmail(String(fd.get("email") ?? ""));
            setSaved(true);
            setEditingAddress(false);
            formAction(fd);
          }}
          className="tile grid gap-4"
        >
          <input type="hidden" name="idempotency_key" value={idempotencyKey} />
          {orderId && <input type="hidden" name="order_id" value={orderId} />}

          {/* Guest checkout: one field, and it's the one a receipt needs
              anyway. No password, no signup step — the emailed link that
              follows is what proves the address and sets the account up. */}
          {needsEmail && (
            <fieldset className="grid gap-3 border-0 p-0">
              <legend className="microlabel microlabel--ink mb-1">Where to send it</legend>
              <label className="field">
                <span className="field__label">Email</span>
                <input
                  name="email"
                  type="email"
                  className="ctl !max-w-none"
                  required
                  autoComplete="email"
                  placeholder="you@somewhere"
                  defaultValue={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <span className="field__hint">
                  Your receipt, dispatch updates and a link to track the order. No password
                  needed — and no account to create first.{" "}
                  <Link href={`/login?next=${encodeURIComponent("/checkout")}`} className="jumplink">
                    Already have an account?
                  </Link>
                </span>
              </label>
            </fieldset>
          )}

          {allowsCollection && (
            <label className="flex items-center gap-2 text-micro">
              <input
                type="checkbox"
                name="is_collection"
                checked={collection}
                onChange={(event) => setCollection(event.target.checked)}
                className="sq"
              />
              Collecting in person — no delivery address needed
            </label>
          )}

          {!allowsCollection && mixedFulfilment && (
            <p className="field__hint">
              Collection isn&apos;t available for baskets that mix collection and shipping-only
              parts — buy the collection items separately if you&apos;d rather pick them up.
            </p>
          )}

          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="microlabel microlabel--ink mb-1">
              {collection ? "Who's collecting" : "Where it ships"}
            </legend>

            <label className="field">
              <span className="field__label">Name</span>
              <input
                name="ship_name"
                className="ctl !max-w-none"
                required
                autoComplete="name"
                defaultValue={address.name}
              />
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
                    defaultValue={address.line1}
                  />
                </label>
                <label className="field">
                  <span className="field__label">Address line 2 (optional)</span>
                  <input
                    name="ship_line2"
                    className="ctl !max-w-none"
                    autoComplete="address-line2"
                    defaultValue={address.line2}
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
                      defaultValue={address.city}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">Postcode</span>
                    <input
                      name="ship_postcode"
                      className="ctl !max-w-none"
                      required
                      autoComplete="postal-code"
                      defaultValue={address.postcode}
                    />
                  </label>
                </div>
                <div className="field--row">
                  <label className="field">
                    <span className="field__label">Country</span>
                    <select
                      name="ship_country"
                      className="ctl !max-w-none"
                      required
                      autoComplete="country"
                      value={address.country}
                      onChange={(event) =>
                        setAddress((prev) => ({ ...prev, country: event.target.value }))
                      }
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field__label">
                      State / province / region{stateRequired ? "" : " (optional)"}
                    </span>
                    <input
                      name="ship_state"
                      className="ctl !max-w-none"
                      required={stateRequired}
                      autoComplete="address-level1"
                      defaultValue={address.state}
                    />
                    <span className="field__hint">
                      {stateRequired
                        ? "Required for delivery to this country."
                        : "Add it if your address uses one."}
                    </span>
                  </label>
                </div>
              </>
            )}

            <label className="field">
              <span className="field__label">Phone (optional)</span>
              <input
                name="ship_phone"
                className="ctl !max-w-none"
                autoComplete="tel"
                defaultValue={address.phone}
              />
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
