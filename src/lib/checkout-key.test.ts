import { createHash } from "node:crypto";

import { beforeEach, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  values: new Map<string, string>(),
  set: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (store.values.has(name) ? { value: store.values.get(name) } : undefined),
    set: store.set,
    delete: store.delete,
  }),
}));
vi.mock("@/lib/cookie-security", () => ({ secureCookies: () => true }));

import {
  CHECKOUT_KEY_COOKIE,
  cartCheckoutRequestKey,
  forgetCheckoutKey,
  readCheckoutKey,
  rememberCheckoutKey,
} from "./checkout-key";

const KEY = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  store.values.clear();
  vi.clearAllMocks();
});

it("N85: renders back the key the checkout reserved under, so a reload resumes it", async () => {
  store.values.set(CHECKOUT_KEY_COOKIE, KEY);
  await expect(readCheckoutKey()).resolves.toBe(KEY);
});

it("ignores a cookie that isn't a checkout key", async () => {
  store.values.set(CHECKOUT_KEY_COOKIE, "not-a-key");
  await expect(readCheckoutKey()).resolves.toBeNull();
});

it("remembers the key server-side only, for longer than a reservation lasts", async () => {
  await rememberCheckoutKey(KEY);
  expect(store.set).toHaveBeenCalledWith(CHECKOUT_KEY_COOKIE, KEY, expect.objectContaining({
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 3600,
  }));
  await rememberCheckoutKey("junk");
  expect(store.set).toHaveBeenCalledTimes(1);
});

it("forgets the key once the checkout is over", async () => {
  await forgetCheckoutKey();
  expect(store.delete).toHaveBeenCalledWith(CHECKOUT_KEY_COOKIE);
});

it("keeps the request-key digest checkouts in flight were saved under", () => {
  expect(cartCheckoutRequestKey("buyer-1", KEY)).toBe(
    createHash("sha256").update(JSON.stringify(["cart-checkout:v1", "user:buyer-1", KEY])).digest("hex")
  );
});
