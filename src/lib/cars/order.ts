/**
 * One answer to "which of my cars comes first?" (P-5).
 *
 * Four surfaces used to sort a member's cars, and they did not agree —
 * created ascending in the garage, descending on the profile, whichever the
 * query happened to return on the sell form. The member never got a say, so
 * somebody with four cars saw a different "first" car depending on where they
 * were standing.
 *
 * The rule: the main car, then everything else newest first. A member with no
 * main car set — the ordinary state — gets exactly the newest-first order
 * every surface shows today, so nothing changes until they choose.
 */

export type OrderableCar = {
  id: string;
  created_at?: string | null;
};

export function orderCars<T extends OrderableCar>(
  cars: T[],
  mainCarId: string | null | undefined
): T[] {
  const byNewest = [...cars].sort((a, b) => {
    const at = a.created_at ?? "";
    const bt = b.created_at ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    // Total order, so repeated renders and paged reads agree.
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  if (!mainCarId) return byNewest;
  const main = byNewest.find((c) => c.id === mainCarId);
  if (!main) return byNewest;
  return [main, ...byNewest.filter((c) => c.id !== mainCarId)];
}

/** The car a surface should lead with, or null when there are none. */
export function leadCar<T extends OrderableCar>(
  cars: T[],
  mainCarId: string | null | undefined
): T | null {
  return orderCars(cars, mainCarId)[0] ?? null;
}

/**
 * A bounded "newest N" read can't lead with a main car older than its N
 * (RR-12): sorting can only reorder the rows it was given. Surfaces that
 * limit their car read fetch the main car on its own and merge it in here —
 * once, and only when it really is the owner's.
 */
export function withMainCar<T extends OrderableCar>(
  recent: T[],
  main: (T & { owner_id: string }) | null | undefined,
  ownerId: string
): T[] {
  if (!main || main.owner_id !== ownerId || recent.some((c) => c.id === main.id)) return recent;
  return [...recent, main];
}
