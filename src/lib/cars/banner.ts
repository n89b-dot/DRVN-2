import { leadCar, type OrderableCar } from "./order";

/**
 * The profile banner (P-1, P-5).
 *
 * A banner must never become a setup step: nobody should have to upload a
 * second image just so their profile isn't blank. So it is chosen from
 * photos that already exist, in the order of what the member most likely
 * means:
 *
 *   1. their main car's cover, if that car is public and has one;
 *   2. otherwise any other public car's cover, newest first;
 *   3. otherwise no banner at all — a plain header, which is a fine thing to
 *      be, and much better than a stretched placeholder.
 *
 * Private cars never contribute. A cover is public because the car is; using
 * one behind a public profile would republish a photo its owner kept back.
 */

export type BannerCandidate = OrderableCar & {
  is_public?: boolean | null;
  cover_image_url?: string | null;
};

export function profileBannerUrl(
  cars: BannerCandidate[],
  mainCarId: string | null | undefined
): string | null {
  const usable = cars.filter((c) => c.is_public && c.cover_image_url);
  if (!usable.length) return null;
  return leadCar(usable, mainCarId)?.cover_image_url ?? null;
}
