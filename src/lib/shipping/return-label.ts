import "server-only";
import type { Json } from "@/lib/database.generated";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { PurchasedLabel, ShippingProvider } from "./types";

type Admin = ReturnType<typeof createAdminClient>;
export type FrozenReturnRate = {
  shipmentRef: string; rateRef: string; amountCents: number; currency: string;
  carrier: string; service: string; endShipperRef: string | null;
};
type SavedRequest = { provider: string; rated: FrozenReturnRate; completed_at: string | null; label: PurchasedLabel | null };

/** A retry never rates a replacement shipment after postage may have been bought. */
export async function ensureReturnLabel(admin: Admin, input: {
  returnId: string; actorId: string; provider: ShippingProvider;
  createRate: () => Promise<FrozenReturnRate>;
}): Promise<PurchasedLabel> {
  const existing = await admin.from("return_label_requests").select("provider,rated,completed_at,label").eq("return_id", input.returnId).maybeSingle();
  if (existing.error) throw new Error("Could not inspect the saved return label request");
  let saved = existing.data as unknown as SavedRequest | null;
  if (!saved) {
    // Rating creates no postage charge. Concurrent rates may be unused; only
    // the provider shipment selected by this atomic RPC is ever purchased.
    const rate = await input.createRate();
    const prepared = await admin.rpc("prepare_return_label", {
      p_return: input.returnId, p_actor: input.actorId, p_provider: input.provider.name,
      p_rated: rate as unknown as Json,
    });
    if (prepared.error || !prepared.data) throw new Error("Could not persist the return label request");
    saved = prepared.data as unknown as SavedRequest;
  }
  if (saved.provider !== input.provider.name) throw new Error("Return label provider changed");
  if (saved.completed_at && saved.label) return saved.label;
  const label = await input.provider.buyLabel({
    shipmentRef: saved.rated.shipmentRef, rateRef: saved.rated.rateRef,
    endShipperRef: saved.rated.endShipperRef, idempotencyKey: `retlabel:${input.returnId}`,
  });
  const completed = await admin.rpc("complete_return_label", { p_return: input.returnId, p_label: label as unknown as Json });
  if (completed.error || !(completed.data as { ok?: boolean } | null)?.ok) {
    throw new Error("Return postage may be purchased; its saved request still needs reconciliation");
  }
  return label;
}
