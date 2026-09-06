import "server-only";

import type { Json } from "@/lib/database.generated";
import type { createAdminClient } from "@/lib/supabase/admin";

import type { PurchasedLabel, ShippingProvider } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

export type FrozenOutboundRate = {
  shipmentRef: string;
  rateRef: string;
  amountCents: number;
  currency: string;
  carrier: string;
  service: string;
  endShipperRef: string | null;
};

type SavedRequest = {
  provider: string;
  rated: FrozenOutboundRate;
  completed_at: string | null;
  label: PurchasedLabel | null;
};

/**
 * Persists one provider shipment/rate before postage purchase. Once a buy may
 * have happened, every retry uses that saved provider identity and relies on
 * the provider's read-after-buy recovery; it never silently re-rates.
 */
export async function ensureOutboundLabel(admin: Admin, input: {
  shipmentId: string;
  actorId: string;
  provider: ShippingProvider;
  createRate: () => Promise<FrozenOutboundRate>;
}): Promise<PurchasedLabel> {
  const existing = await admin
    .from("outbound_label_requests")
    .select("provider,rated,completed_at,label")
    .eq("shipment_id", input.shipmentId)
    .maybeSingle();
  if (existing.error) throw new Error("Could not inspect the saved outbound label request");

  let saved = existing.data as unknown as SavedRequest | null;
  if (!saved) {
    // Rating does not buy postage. Concurrent rates may be unused, while the
    // database chooses the single identity which callers are allowed to buy.
    const rate = await input.createRate();
    const prepared = await admin.rpc("prepare_outbound_label", {
      p_shipment: input.shipmentId,
      p_actor: input.actorId,
      p_provider: input.provider.name,
      p_rated: rate as unknown as Json,
    });
    if (prepared.error || !prepared.data) throw new Error("Could not persist the outbound label request");
    saved = prepared.data as unknown as SavedRequest;
  }

  if (saved.provider !== input.provider.name) throw new Error("Outbound label provider changed");
  if (saved.completed_at && saved.label) return saved.label;

  const label = await input.provider.buyLabel({
    shipmentRef: saved.rated.shipmentRef,
    rateRef: saved.rated.rateRef,
    endShipperRef: saved.rated.endShipperRef,
    idempotencyKey: `label:${input.shipmentId}`,
  });
  const completed = await admin.rpc("complete_outbound_label", {
    p_shipment: input.shipmentId,
    p_label: label as unknown as Json,
  });
  if (completed.error || !(completed.data as { ok?: boolean } | null)?.ok) {
    throw new Error("Outbound postage may be purchased; its saved request still needs reconciliation");
  }
  return label;
}
