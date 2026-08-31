import "server-only";

import { COUNTRIES } from "@/lib/geo/countries";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SellerFulfillmentProfile } from "@/lib/database.types";
import type { ShippingAddress } from "@/lib/shipping/types";

/**
 * Seller fulfillment profile (brief §9, migration 0051) — the PRIVATE
 * ship-from/return address + handling config every DRVN Shipping seller
 * needs. Reads are owner/admin-scoped by RLS; all writes go through
 * fulfillment-actions.ts on the service-role client, so validation lives
 * here where both the action and future checkout code can share it.
 *
 * This address is never shown to buyers and never appears in the commercial
 * snapshot. Public shop location stays a profiles concern.
 */

export type FulfillmentFields = {
  ship_from_name: string;
  company: string | null;
  street1: string;
  street2: string | null;
  city: string;
  state: string | null;
  postal_code: string;
  country: string;
  phone: string | null;
  default_handling_days: number;
};

const VALID_COUNTRY = new Set(COUNTRIES.map((c) => c.code));

function cleanLine(value: FormDataEntryValue | null, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

/** Parse + validate the settings form. Returns fields or a user-facing error. */
export function readFulfillmentFields(
  formData: FormData
): { fields: FulfillmentFields } | { error: string } {
  const name = cleanLine(formData.get("ship_from_name"), 80);
  const street1 = cleanLine(formData.get("street1"), 120);
  const city = cleanLine(formData.get("city"), 80);
  const postal = cleanLine(formData.get("postal_code"), 20);
  const country = cleanLine(formData.get("country"), 2)?.toUpperCase() ?? null;

  if (!name) return { error: "Ship-from name is required." };
  if (!street1) return { error: "Street address is required." };
  if (!city) return { error: "City is required." };
  if (!postal) return { error: "Postal code is required." };
  if (!country || !VALID_COUNTRY.has(country)) return { error: "Pick a country." };

  const handlingRaw = cleanLine(formData.get("default_handling_days"), 4);
  const handling = handlingRaw ? Number(handlingRaw) : 2;
  if (!Number.isInteger(handling) || handling < 1 || handling > 10) {
    return { error: "Handling time must be between 1 and 10 days." };
  }

  return {
    fields: {
      ship_from_name: name,
      company: cleanLine(formData.get("company"), 80),
      street1,
      street2: cleanLine(formData.get("street2"), 120),
      city,
      state: cleanLine(formData.get("state"), 40),
      postal_code: postal,
      country,
      phone: cleanLine(formData.get("phone"), 30),
      default_handling_days: handling,
    },
  };
}

export async function loadFulfillmentProfile(
  sellerId: string
): Promise<SellerFulfillmentProfile | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("seller_fulfillment_profiles")
    .select("*")
    .eq("seller_id", sellerId)
    .maybeSingle();
  return data ?? null;
}

/** True once the seller can rate/buy DRVN Shipping labels: a saved profile
 *  whose address a provider has verified. */
export function fulfillmentProfileReady(
  profile: Pick<SellerFulfillmentProfile, "address_verified_at"> | null
): boolean {
  return Boolean(profile?.address_verified_at);
}

export function shipFromAddress(profile: SellerFulfillmentProfile): ShippingAddress {
  return {
    name: profile.ship_from_name,
    company: profile.company,
    street1: profile.street1,
    street2: profile.street2,
    city: profile.city,
    state: profile.state,
    postalCode: profile.postal_code,
    country: profile.country,
    phone: profile.phone,
  };
}

/** Return address, falling back to ship-from (the 0051 all-or-nothing rule). */
export function returnAddress(profile: SellerFulfillmentProfile): ShippingAddress {
  if (!profile.return_street1) return shipFromAddress(profile);
  return {
    name: profile.return_name ?? profile.ship_from_name,
    company: profile.company,
    street1: profile.return_street1,
    street2: profile.return_street2,
    city: profile.return_city ?? profile.city,
    state: profile.return_state,
    postalCode: profile.return_postal_code ?? profile.postal_code,
    country: profile.return_country ?? profile.country,
    phone: profile.phone,
  };
}
