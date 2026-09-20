import { formatPrice } from "./taxonomy";

export function deliveryLabel(item: { shipping_mode?: string; shipping_cents?: number | null; allows_collection?: boolean }): string {
  if (item.shipping_mode === "pickup_only") return "Pickup only";
  const shipping = item.shipping_mode === "drvn" ? "Shipping calculated at checkout"
    : typeof item.shipping_cents !== "number" ? "Delivery details not provided"
    : item.shipping_cents > 0 ? `+ ${formatPrice(item.shipping_cents)} shipping`
    : item.shipping_mode === "flat" ? "Shipping included" : "Delivery details on listing";
  return shipping + (item.allows_collection ? " · Pickup available" : "");
}
