/**
 * A-3: the composer's "Sell this part →" link on a mod block. "Replaced"
 * earns it as much as "removed" — a replaced part is exactly the one sitting
 * in a box waiting to be sold. It needs the block's mod id: the sell form
 * prefills from that build entry, so a typed-in part has nothing to carry.
 */
export function modBlockSellHref(action: string, modItemId: string | null | undefined, carId: string): string | null {
  if (action !== "removed" && action !== "replaced") return null;
  if (!modItemId) return null;
  return `/sell?car=${carId}&mod=${modItemId}`;
}
