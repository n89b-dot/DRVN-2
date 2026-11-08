import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn(), listing: vi.fn(), redirect: vi.fn(), release: vi.fn(), user: vi.fn(), guestOrders: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/cart", () => ({ MAX_CART_ITEMS: 50, getCartIds: mocks.get, setCartIds: mocks.set, removeCartIds: mocks.remove }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user() } }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.listing }) }) }) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/guest-checkout", () => ({ readGuestOrders: mocks.guestOrders }));
vi.mock("./checkout-release", () => ({ releaseCheckoutHolding: mocks.release }));
import { addToCart, buyNow, removeFromCart } from "./cart-actions";
function form() { const data = new FormData(); data.set("listing_id", "part"); return data; }
beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue([]); mocks.set.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined); mocks.listing.mockResolvedValue({ data: { id: "part", status: "active", seller_id: "seller" } }); mocks.redirect.mockImplementation(() => { throw new Error("redirect"); }); mocks.release.mockResolvedValue({ outcome: "none" }); mocks.user.mockReturnValue({ id: "buyer" }); mocks.guestOrders.mockResolvedValue([]); });
it("does not add the same item twice", async () => { mocks.get.mockResolvedValue(["part"]); expect((await addToCart(form())).ok).toBeTruthy(); expect(mocks.set).not.toHaveBeenCalled(); });
it("does not claim success for an item beyond cart capacity", async () => { mocks.get.mockResolvedValue(Array.from({ length: 50 }, (_, i) => `part-${i}`)); expect((await addToCart(form())).error).toContain("full"); expect(mocks.set).not.toHaveBeenCalled(); });
it("announces cookie write failure", async () => { mocks.set.mockRejectedValue(new Error("cookie failure")); expect((await addToCart(form())).error).toContain("Couldn't save"); });
it("buy now shares availability validation", async () => { mocks.listing.mockResolvedValue({ data: { status: "sold" } }); expect((await buyNow(form())).error).toContain("no longer available"); expect(mocks.set).not.toHaveBeenCalled(); expect(mocks.redirect).not.toHaveBeenCalled(); });
it("buy now does not redirect after a failed cookie write", async () => { mocks.set.mockRejectedValue(new Error("cookie failure")); expect((await buyNow(form())).error).toBeTruthy(); expect(mocks.redirect).not.toHaveBeenCalled(); });
it("buy now redirects after a successful cart write", async () => { await expect(buyNow(form())).rejects.toThrow("redirect"); expect(mocks.set).toHaveBeenCalledWith(["part"]); expect(mocks.redirect).toHaveBeenCalledWith("/cart?buynow=1"); });
it("removal is retryable after cookie failure", async () => { mocks.remove.mockRejectedValueOnce(new Error("cookie failure")); expect((await removeFromCart(form())).error).toBeTruthy(); expect((await removeFromCart(form())).ok).toBeTruthy(); expect(mocks.remove).toHaveBeenCalledTimes(2); });

// OS-W17 ("Edit cart"): a held part keeps Remove, and removing it releases the
// buyer's own checkout so the changed basket can check out again at once.
it("Edit cart: removing a part the buyer's checkout holds releases that checkout, then drops the line", async () => {
  mocks.release.mockResolvedValue({ outcome: "released" });
  const result = await removeFromCart(form());
  expect(mocks.release).toHaveBeenCalledWith(expect.anything(), { listingId: "part", buyerId: "buyer" });
  expect(mocks.release.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
  expect(mocks.remove).toHaveBeenCalledWith(["part"]);
  expect(result.ok).toContain("checkout was released");
});
it("Edit cart: a guest's held part is released through this browser's signed receipt", async () => {
  mocks.user.mockReturnValue(null);
  mocks.guestOrders.mockResolvedValue(["order-guest"]);
  mocks.release.mockResolvedValue({ outcome: "released" });
  await removeFromCart(form());
  expect(mocks.release).toHaveBeenCalledWith(expect.anything(), { listingId: "part", guestOrderIds: ["order-guest"] });
  expect(mocks.remove).toHaveBeenCalledWith(["part"]);
});
it("Edit cart: keeps the line (and the hold) when the checkout's payment can't be resolved", async () => {
  mocks.release.mockResolvedValue({ outcome: "unresolved" });
  const result = await removeFromCart(form());
  expect(result.error).toContain("still being confirmed");
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("Edit cart: says the part is paid for instead of removing it when the checkout settled", async () => {
  mocks.release.mockResolvedValue({ outcome: "settled" });
  const result = await removeFromCart(form());
  expect(result.error).toContain("already been paid");
  expect(mocks.remove).not.toHaveBeenCalled();
});
