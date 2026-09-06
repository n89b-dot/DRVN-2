import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn(), listing: vi.fn(), redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/cart", () => ({ MAX_CART_ITEMS: 50, getCartIds: mocks.get, setCartIds: mocks.set, removeCartIds: mocks.remove }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "buyer" } } }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.listing }) }) }) }) }));
import { addToCart, buyNow, removeFromCart } from "./cart-actions";
function form() { const data = new FormData(); data.set("listing_id", "part"); return data; }
beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue([]); mocks.set.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined); mocks.listing.mockResolvedValue({ data: { id: "part", status: "active", seller_id: "seller" } }); mocks.redirect.mockImplementation(() => { throw new Error("redirect"); }); });
it("does not add the same item twice", async () => { mocks.get.mockResolvedValue(["part"]); expect((await addToCart(form())).ok).toBeTruthy(); expect(mocks.set).not.toHaveBeenCalled(); });
it("does not claim success for an item beyond cart capacity", async () => { mocks.get.mockResolvedValue(Array.from({ length: 50 }, (_, i) => `part-${i}`)); expect((await addToCart(form())).error).toContain("full"); expect(mocks.set).not.toHaveBeenCalled(); });
it("announces cookie write failure", async () => { mocks.set.mockRejectedValue(new Error("cookie failure")); expect((await addToCart(form())).error).toContain("Couldn't save"); });
it("buy now shares availability validation", async () => { mocks.listing.mockResolvedValue({ data: { status: "sold" } }); expect((await buyNow(form())).error).toContain("no longer available"); expect(mocks.set).not.toHaveBeenCalled(); expect(mocks.redirect).not.toHaveBeenCalled(); });
it("buy now does not redirect after a failed cookie write", async () => { mocks.set.mockRejectedValue(new Error("cookie failure")); expect((await buyNow(form())).error).toBeTruthy(); expect(mocks.redirect).not.toHaveBeenCalled(); });
it("buy now redirects after a successful cart write", async () => { await expect(buyNow(form())).rejects.toThrow("redirect"); expect(mocks.set).toHaveBeenCalledWith(["part"]); expect(mocks.redirect).toHaveBeenCalledWith("/cart?buynow=1"); });
it("removal is retryable after cookie failure", async () => { mocks.remove.mockRejectedValueOnce(new Error("cookie failure")); expect((await removeFromCart(form())).error).toBeTruthy(); expect((await removeFromCart(form())).ok).toBeTruthy(); expect(mocks.remove).toHaveBeenCalledTimes(2); });
