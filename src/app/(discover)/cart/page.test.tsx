import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

/**
 * OS-W17 — the cart a checkout sends the buyer back to.
 * N482: it renders the reason it was sent (`?error=`), which it used to drop.
 * N85: a part the buyer's own unfinished checkout holds reads as theirs to
 * finish, not "Someone else has this reserved".
 */

const mocks = vi.hoisted(() => ({
  cartIds: vi.fn(),
  listings: vi.fn(),
  holds: vi.fn(),
}));

function query(table: string) {
  const result = () => (table === "listings" ? mocks.listings() : { data: [], error: null });
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order"]) builder[method] = () => builder;
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return builder;
}

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "buyer-1" } } }) },
    from: (table: string) => query(table),
  }),
}));
vi.mock("@/lib/cart", () => ({ getCartIds: mocks.cartIds }));
vi.mock("@/lib/checkout-data", () => ({ loadOwnCheckoutHolds: mocks.holds }));
vi.mock("@/lib/payments/provider", () => ({ paymentsAreLive: () => false }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/features/commerce/cart-remove-button", () => ({ CartRemoveButton: () => <button>Remove</button> }));
vi.mock("@/components/livesheet", () => ({
  Rv: ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>,
}));

const { default: CartPage } = await import("./page");

const listing = (status: string) => ({
  id: "listing-1",
  title: "Intercooler",
  price_cents: 25000,
  shipping_cents: 1200,
  allows_collection: false,
  currency: "USD",
  status,
  seller_id: "seller-1",
});

async function render(error?: string) {
  return renderToStaticMarkup(await CartPage({ searchParams: Promise.resolve({ error }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cartIds.mockResolvedValue(["listing-1"]);
  mocks.listings.mockReturnValue({ data: [listing("active")], error: null });
  mocks.holds.mockResolvedValue(new Map());
});

it("N482: shows why a payment sent the buyer back to the cart", async () => {
  const html = await render("payment-failed");
  expect(html).toContain("Payment didn&#x27;t go through");
  expect(html).toContain('role="alert"');
});

it("N482: shows nothing extra without an error", async () => {
  const html = await render();
  expect(html).not.toContain('role="alert"');
});

it("N85: the buyer's own held part says their checkout holds it, with the way to finish", async () => {
  mocks.listings.mockReturnValue({ data: [listing("reserved")], error: null });
  mocks.holds.mockResolvedValue(new Map([["listing-1", "/checkout"]]));

  const html = await render();

  expect(html).toContain("Your checkout is holding this");
  expect(html).not.toContain("Someone else has this reserved");
  expect(html).toContain('href="/checkout"');
  expect(html).toContain("Finish checkout");
});

it("Edit cart: a held part keeps Remove beside Finish checkout, so the basket can change", async () => {
  mocks.listings.mockReturnValue({ data: [listing("reserved")], error: null });
  mocks.holds.mockResolvedValue(new Map([["listing-1", "/checkout?order=11111111-1111-4111-8111-111111111111"]]));

  const html = await render();

  expect(html).toContain("Finish checkout");
  expect(html).toContain("<button>Remove</button>");
  // The summary's Finish checkout resumes the same held checkout by order.
  expect(html.match(/href="\/checkout\?order=11111111-1111-4111-8111-111111111111"/g)?.length).toBe(2);
});

it("a part reserved by another buyer still says so", async () => {
  mocks.listings.mockReturnValue({ data: [listing("reserved")], error: null });

  const html = await render();

  expect(html).toContain("Someone else has this reserved");
  expect(html).not.toContain("Finish checkout");
});
