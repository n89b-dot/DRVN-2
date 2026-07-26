import { cookies } from "next/headers";

const CART_COOKIE = "drvn_cart";

/** Cookie-based cart: an array of listing ids. Server-only helpers. */
export async function getCartIds(): Promise<string[]> {
  const store = await cookies();
  try {
    const raw = store.get(CART_COOKIE)?.value;
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}

export async function setCartIds(ids: string[]) {
  const store = await cookies();
  store.set(CART_COOKIE, JSON.stringify([...new Set(ids)]), {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
  });
}
