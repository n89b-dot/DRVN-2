"use client";

import { useActionState, useId, useState } from "react";

import { checkoutCart, type CommerceState } from "@/features/commerce/actions";

/**
 * The checkout step the flow was missing: a delivery address (never collected
 * before, so a paid order had no destination), an explicit collection option,
 * and a review-before-paying moment.
 *
 * `idempotencyKey` is minted once per mounted form, so a double-submit or a
 * retry replays the first result instead of creating a second set of orders.
 */
export function CheckoutForm({
  idempotencyKey,
  allowsCollection,
  total,
  paymentsAreLive,
  action = checkoutCart,
  orderId,
  submitLabel,
}: {
  idempotencyKey: string;
  allowsCollection: boolean;
  total: string;
  paymentsAreLive: boolean;
  /** Defaults to cart checkout; a reserved order passes its own completion action. */
  action?: (prev: CommerceState, formData: FormData) => Promise<CommerceState>;
  orderId?: string;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<CommerceState, FormData>(action, {});
  const [collection, setCollection] = useState(false);
  const errorId = useId();

  return (
    <form action={formAction} className="mt-4 grid gap-4">
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

      {!paymentsAreLive && (
        <p className="spec-note">
          <b>Test mode.</b> No card is taken and no money moves — this places a real order record
          against a stub processor.
        </p>
      )}

      <button type="submit" disabled={pending} className="btn btn--live w-full">
        {pending ? "Placing order…" : (submitLabel ?? `Confirm and pay ${total}`)}
      </button>

      {/* aria-live so a screen reader hears the failure, not just sighted users. */}
      <p
        id={errorId}
        role="alert"
        aria-live="polite"
        className={state.error ? "field__err" : "sr-only"}
      >
        {state.error ?? ""}
      </p>
    </form>
  );
}
