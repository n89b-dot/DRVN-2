import { cookies } from "next/headers";

const CART_COOKIE = "drvn_cart";
const MAX_ITEMS = 50;

/**
 * Cookie-based cart: an array of listing ids only.
 *
 * Prices are deliberately *not* stored here — they are re-read from the
 * database at checkout, so a tampered cookie cannot change what anyone pays.
 * The ids are still user-controlled, so `purchase_begin` validates each one.
 */
export async function getCartIds(): Promise<string[]> {
  const store = await cookies();
  try {
    const raw = store.get(CART_COOKIE)?.value;
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(ids)) return [];
    return [...new Set(ids.filter((id): id is string => typeof id === "string"))].slice(
      0,
      MAX_ITEMS
    );
  } catch {
    return [];
  }
}

export async function setCartIds(ids: string[]) {
  const store = await cookies();
  store.set(CART_COOKIE, JSON.stringify([...new Set(ids)].slice(0, MAX_ITEMS)), {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    // The cart is only ever read server-side; keeping it out of document.cookie
    // removes it as an XSS target.
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}

/** Removes specific ids — used after checkout so unpurchased items survive. */
export async function removeCartIds(idsToRemove: string[]) {
  const remove = new Set(idsToRemove);
  const remaining = (await getCartIds()).filter((id) => !remove.has(id));
  await setCartIds(remaining);
}

export async function cartCount(): Promise<number> {
  return (await getCartIds()).length;
}
