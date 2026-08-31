"use client";

import { useActionState } from "react";

import { ActionFooter, Button, Select, TextField, TileHead } from "@/components/ui";
import {
  saveFulfillmentProfile,
  type FulfillmentState,
} from "@/features/commerce/fulfillment-actions";
import type { Country } from "@/lib/geo/countries";

/**
 * Settings → Shipping — the seller's private ship-from profile (0051).
 * One address + handling time; DRVN Shipping rates and labels come from it.
 * Deliberately not the public shop location: this is fulfilment data buyers
 * never see.
 */
export type ShippingProfileValues = {
  ship_from_name: string;
  company: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone: string;
  default_handling_days: number;
  verified: boolean;
};

export function ShippingSection({
  initial,
  countries,
  integratedShipping,
}: {
  initial: ShippingProfileValues | null;
  countries: Country[];
  integratedShipping: boolean;
}) {
  const [state, action, pending] = useActionState<FulfillmentState, FormData>(
    saveFulfillmentProfile,
    {}
  );

  return (
    <section id="shipping" className="tile">
      <TileHead
        label="Shipping — where your parts ship from"
        end={
          initial?.verified ? (
            <span className="chip chip--ok">Address verified</span>
          ) : initial ? (
            <span className="chip">Not verified</span>
          ) : undefined
        }
      />
      <p className="field__hint mt-2 max-w-[62ch]">
        Private to you — buyers never see this address. It&apos;s what shipping
        rates and labels are calculated from
        {integratedShipping ? "" : " once DRVN Shipping is available"}.
      </p>
      <form action={action} className="mt-4 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id="ship-from-name"
            label="Name"
            name="ship_from_name"
            defaultValue={initial?.ship_from_name ?? ""}
            required
            autoComplete="name"
            className="!max-w-none"
            fieldClassName="!mb-0"
          />
          <TextField
            id="ship-company"
            label="Company (optional)"
            name="company"
            defaultValue={initial?.company ?? ""}
            autoComplete="organization"
            className="!max-w-none"
            fieldClassName="!mb-0"
          />
        </div>
        <TextField
          id="ship-street1"
          label="Street address"
          name="street1"
          defaultValue={initial?.street1 ?? ""}
          required
          autoComplete="address-line1"
          className="!max-w-none"
          fieldClassName="!mb-0"
        />
        <TextField
          id="ship-street2"
          label="Apt, suite, unit (optional)"
          name="street2"
          defaultValue={initial?.street2 ?? ""}
          autoComplete="address-line2"
          className="!max-w-none"
          fieldClassName="!mb-0"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            id="ship-city"
            label="City"
            name="city"
            defaultValue={initial?.city ?? ""}
            required
            autoComplete="address-level2"
            className="!max-w-none"
            fieldClassName="!mb-0"
          />
          <TextField
            id="ship-state"
            label="State / region"
            name="state"
            defaultValue={initial?.state ?? ""}
            autoComplete="address-level1"
            className="!max-w-none"
            fieldClassName="!mb-0"
          />
          <TextField
            id="ship-postal"
            label="Postal code"
            name="postal_code"
            defaultValue={initial?.postal_code ?? ""}
            required
            autoComplete="postal-code"
            className="!max-w-none"
            fieldClassName="!mb-0"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            id="ship-country"
            label="Country"
            name="country"
            defaultValue={initial?.country ?? "US"}
            required
            className="!max-w-none"
            fieldClassName="!mb-0"
          >
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
          <TextField
            id="ship-phone"
            label="Phone (carriers may require it)"
            name="phone"
            type="tel"
            defaultValue={initial?.phone ?? ""}
            autoComplete="tel"
            className="!max-w-none"
            fieldClassName="!mb-0"
          />
          <TextField
            id="ship-handling"
            label="Handling time (days)"
            name="default_handling_days"
            type="number"
            min={1}
            max={10}
            defaultValue={String(initial?.default_handling_days ?? 2)}
            required
            className="!max-w-none"
            fieldClassName="!mb-0"
            hint="How long you need to get a sold part boxed and to the carrier."
          />
        </div>
        {state.error && (
          <p role="alert" aria-live="polite" className="field__err">
            {state.error}
          </p>
        )}
        <ActionFooter
          status={state.ok ? { kind: "ok", message: state.ok } : null}
        >
          <Button type="submit" loading={pending} pendingLabel="Saving…">
            Save shipping details
          </Button>
        </ActionFooter>
      </form>
    </section>
  );
}
