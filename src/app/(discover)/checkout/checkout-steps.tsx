"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useId, useState } from "react";

import { AnimatePresence, motion } from "motion/react";

import { Button, Select, Stepper, TextField } from "@/components/ui";
import { springs, transitions } from "@/lib/motion";
import { checkoutCart, type CommerceState } from "@/features/commerce/actions";
import {
  quoteCartShipping,
  type CartShippingQuotes,
} from "@/features/commerce/shipping-quote-actions";
import type { SavedCard } from "@/lib/payments/customers";
import { formatPrice } from "@/lib/payments/fee";
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
 * what creates the orders + PaymentIntent. Retries preserve that request's
 * original basket, address and service. The server rejects changed details
 * once checkout has started; reopening this form does not change a payment.
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
  drvnListings = [],
  baseTotalCents,
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
  /** DRVN-Shipping lines (0053): the address submit first fetches live rates
   *  for these, and payment waits for a service selection. */
  drvnListings?: { id: string; title: string }[];
  /** Cents backing `total`, so a selected rate can re-total live. */
  baseTotalCents?: number;
}) {
  const [state, formAction, pending] = useActionState<CommerceState, FormData>(async (previous, data) => {
    try {
      return await action(previous, data);
    } catch (error) {
      unstable_rethrow(error);
      return { error: "We couldn't confirm checkout. Your details are still here. Retry with the same details so we can check the existing payment request." };
    }
  }, {});
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

  // DRVN Shipping (0053): the address submit fetches rates first; payment
  // waits for a service pick. Rates are server-held — the radios carry only
  // opaque quote ids.
  const [rates, ratesAction, ratesPending] = useActionState<CartShippingQuotes, FormData>(
    async (previous, data) => {
      try {
        return await quoteCartShipping(previous, data);
      } catch (error) {
        unstable_rethrow(error);
        return { groups: [], error: "Couldn't fetch shipping rates. Your address is still here; try again." };
      }
    },
    { groups: [] }
  );
  const [pickedQuotes, setPickedQuotes] = useState<Record<string, string>>({});
  const needsRates = drvnListings.length > 0 && !collection;
  const ratesReady = rates.groups.length > 0;
  const chosenFor = (listingId: string): string | undefined => {
    const group = rates.groups.find((g) => g.listingId === listingId);
    if (!group?.options.length) return undefined;
    const picked = pickedQuotes[listingId];
    return picked && group.options.some((o) => o.quoteId === picked)
      ? picked
      : group.options[0].quoteId;
  };
  const selectedShippingCents = rates.groups.reduce((sum, group) => {
    const chosen = chosenFor(group.listingId);
    const option = group.options.find((o) => o.quoteId === chosen);
    return sum + (option?.amountCents ?? 0);
  }, 0);
  const liveTotal =
    needsRates && ratesReady && baseTotalCents != null
      ? formatPrice(baseTotalCents + selectedShippingCents)
      : total;

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
      <Stepper
        label="Checkout progress"
        steps={[
          {
            label: "Shipping",
            state: paymentStep ? "done" : "now",
            end: paymentStep ? <span className="chip chip--ok">Done</span> : undefined,
          },
          { label: "Payment", state: paymentStep ? "now" : "todo" },
        ]}
      />

      {/* Address form ↔ payment review is the app's largest single content
          swap; the crossfade keeps it reading as one continuous flow rather
          than a page replacement. `mode="wait"` so the two compositions
          never overlap; the fast exit keeps checkout feeling immediate. */}
      <AnimatePresence mode="wait" initial={false}>
      {paymentStep ? (
        <motion.div
          key="review"
          className="grid gap-4"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { ...springs.spatial, opacity: transitions.standard } }}
          exit={{ opacity: 0, transition: transitions.fast }}
        >
          {/* Review is two conceptual blocks, each with exactly ONE edit
              affordance (SYS-11): Delivery & contact → Edit reopens the
              address form (every field retained); Items → Edit cart. The
              previous anatomy scattered four identical "Change" controls,
              three of which did the same thing. */}
          <div className="tile grid gap-3">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Delivery &amp; contact</span>
              <button
                type="button"
                onClick={() => setEditingAddress(true)}
                className="jumplink shrink-0"
              >
                Edit
              </button>
            </div>
            <div>
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
            </div>
            {needsEmail && email && (
              <div>
                <span className="field__label block">Confirmation to</span>
                <span className="order__meta block truncate">{email}</span>
              </div>
            )}
          </div>

          {/* Items + the money, immediately before the payment element, so
              the buyer sees the whole commitment in one place before paying. */}
          <div className="tile grid gap-3">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">Items</span>
              <Link href="/cart" className="jumplink shrink-0">
                Edit cart
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
                  <b>{liveTotal}</b>
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
                total={liveTotal}
              />
            ) : (
              state.payment && (
                <PaymentConfirm
                  clientSecret={state.payment.clientSecret}
                  orderIds={state.payment.orderIds}
                  total={liveTotal}
                  canSaveCard
                />
              )
            )}
          </div>
        </motion.div>
      ) : (
        <motion.form
          key="address"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { ...springs.spatial, opacity: transitions.standard } }}
          exit={{ opacity: 0, transition: transitions.fast }}
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
            // First submit with DRVN-Shipping lines fetches rates for this
            // address; the follow-up submit (radios now in the form) pays.
            // A re-opened address form re-fetches — rates are address-bound
            // (the server checks the destination fingerprint regardless).
            if (needsRates && (!ratesReady || editingAddress)) {
              setEditingAddress(false);
              ratesAction(fd);
              return;
            }
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
              <TextField
                id="checkout-email"
                label="Email"
                name="email"
                type="email"
                className="!max-w-none"
                required
                autoComplete="email"
                placeholder="you@somewhere"
                defaultValue={email}
                onChange={(event) => setEmail(event.target.value)}
                hint={
                  <>
                    Your receipt, dispatch updates and a link to track the order. No password
                    needed — and no account to create first.{" "}
                    <Link href={`/login?next=${encodeURIComponent("/checkout")}`} className="jumplink">
                      Already have an account?
                    </Link>
                  </>
                }
              />
            </fieldset>
          )}

          {/* Kept manual: the shared Checkbox renders its label at text-body
              inside a min-h-11 block target — this one is deliberately a
              compact text-micro inline row, so converting would change the
              rendered label size and hit-target. */}
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

            <TextField
              id="checkout-ship-name"
              label="Name"
              name="ship_name"
              className="!max-w-none"
              required
              autoComplete="name"
              defaultValue={address.name}
            />

            {!collection && (
              <>
                <TextField
                  id="checkout-ship-line1"
                  label="Address"
                  name="ship_line1"
                  className="!max-w-none"
                  required
                  autoComplete="address-line1"
                  defaultValue={address.line1}
                />
                <TextField
                  id="checkout-ship-line2"
                  label="Address line 2 (optional)"
                  name="ship_line2"
                  className="!max-w-none"
                  autoComplete="address-line2"
                  defaultValue={address.line2}
                />
                <div className="field--row">
                  <TextField
                    id="checkout-ship-city"
                    label="City"
                    name="ship_city"
                    className="!max-w-none"
                    required
                    autoComplete="address-level2"
                    defaultValue={address.city}
                  />
                  <TextField
                    id="checkout-ship-postcode"
                    label="Postcode"
                    name="ship_postcode"
                    className="!max-w-none"
                    required
                    autoComplete="postal-code"
                    defaultValue={address.postcode}
                  />
                </div>
                <div className="field--row">
                  {/* The country SUBMITS from this state-bound hidden input,
                      not the select: React's post-action form reset reverts a
                      select to its first option without a re-sync render, so
                      a rates submit followed by the payment submit would
                      silently send a different country than was quoted (the
                      destination-fingerprint check then refuses the quote).
                      Browser resets never touch hidden inputs. */}
                  <input type="hidden" name="ship_country" value={address.country} />
                  <Select
                    id="checkout-ship-country"
                    label="Country"
                    className="!max-w-none"
                    required
                    autoComplete="country"
                    // Remount after each rates fetch so the visible selection
                    // re-syncs to state after the post-action form reset.
                    key={`country-${rates.groups.length}`}
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
                  </Select>
                  <TextField
                    id="checkout-ship-state"
                    label={`State / province / region${stateRequired ? "" : " (optional)"}`}
                    name="ship_state"
                    className="!max-w-none"
                    required={stateRequired}
                    autoComplete="address-level1"
                    defaultValue={address.state}
                    hint={
                      stateRequired
                        ? "Required for delivery to this country."
                        : "Add it if your address uses one."
                    }
                  />
                </div>
              </>
            )}

            <TextField
              id="checkout-ship-phone"
              label="Phone (optional)"
              name="ship_phone"
              className="!max-w-none"
              autoComplete="tel"
              defaultValue={address.phone}
            />
          </fieldset>

          {needsRates && ratesReady && (
            <fieldset className="grid gap-4 border-0 p-0">
              <legend className="microlabel microlabel--ink mb-1">Shipping service</legend>
              {rates.groups.map((group) => {
                const chosen = chosenFor(group.listingId);
                return (
                  <div key={group.listingId} className="grid gap-2">
                    {rates.groups.length > 1 && (
                      <span className="block truncate font-medium text-micro">{group.title}</span>
                    )}
                    {group.options.map((option) => (
                      <label
                        key={option.quoteId}
                        className="flex items-center justify-between gap-3 text-micro"
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`quote_${group.listingId}`}
                            value={option.quoteId}
                            checked={chosen === option.quoteId}
                            onChange={() =>
                              setPickedQuotes((prev) => ({
                                ...prev,
                                [group.listingId]: option.quoteId,
                              }))
                            }
                            className="sq"
                          />
                          {option.serviceLabel}
                          {option.estDeliveryDays != null && (
                            <span className="text-dim">
                              · ~{option.estDeliveryDays} day
                              {option.estDeliveryDays === 1 ? "" : "s"}
                            </span>
                          )}
                        </span>
                        <b className="shrink-0">{formatPrice(option.amountCents)}</b>
                      </label>
                    ))}
                  </div>
                );
              })}
              <p className="field__hint">
                Live carrier rates for your address. Changing the address re-fetches them.
              </p>
            </fieldset>
          )}

          <Button
            type="submit"
            variant="live"
            disabled={pending || ratesPending}
            className="w-full"
          >
            {pending || ratesPending
              ? "Saving…"
              : needsRates && !ratesReady
                ? "Get shipping rates"
                : `Continue to payment${needsRates && ratesReady ? ` — ${liveTotal}` : ""}`}
          </Button>

          <p
            id={errorId}
            role="alert"
            aria-live="polite"
            className={state.error || rates.error ? "field__err" : "sr-only"}
          >
            {state.error ?? rates.error ?? ""}
          </p>
        </motion.form>
      )}
      </AnimatePresence>
    </div>
  );
}
