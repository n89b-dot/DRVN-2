/**
 * When an accepted offer's hold on the part ends (N97).
 *
 * The hold is persisted on the reserved listing (`listings.reserved_until`,
 * set by offer_accept_begin); the reservation expiry worker releases the
 * order once any of its parts' reservations lapse, so the earliest one is
 * the order's deadline. No readable value means no promise on the page —
 * never a date derived from when the order was created.
 */
export function reservationHoldEndsAt(listings: { reserved_until: string | null }[]): Date | null {
  let earliest: Date | null = null;
  for (const listing of listings) {
    if (!listing.reserved_until) continue;
    const at = new Date(listing.reserved_until);
    if (Number.isNaN(at.getTime())) continue;
    if (!earliest || at < earliest) earliest = at;
  }
  return earliest;
}
