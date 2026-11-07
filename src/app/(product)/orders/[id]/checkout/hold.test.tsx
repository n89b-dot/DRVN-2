import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N97: the accepted-offer checkout shows when the hold really ends — the
 * reserved listing's persisted reserved_until — not 24 hours after the order
 * was created.
 */

const mocks = vi.hoisted(() => ({
  rows: new Map<string, { data: unknown; error: unknown }>(),
}));

function query(table: string) {
  const result = () => mocks.rows.get(table) ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order"]) builder[method] = () => builder;
  builder.maybeSingle = async () => result();
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return builder;
}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "buyer-1" } } }) },
    from: (table: string) => query(table),
  }),
}));
vi.mock("@/lib/payments/customers", () => ({ listSavedCards: async () => [] }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/features/commerce/actions", () => ({ completeReservedOrder: vi.fn() }));
vi.mock("@/components/livesheet", () => ({
  Rv: ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>,
}));
vi.mock("@/app/(discover)/checkout/checkout-steps", () => ({ CheckoutSteps: () => <div /> }));

const { default: CompleteOrderPage } = await import("./page");
const { reservationHoldEndsAt } = await import("./hold");

const ORDER = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  buyer_id: "buyer-1",
  seller_id: "seller-1",
  seller_label: null,
  status: "pending",
  origin_offer_id: "offer-1",
  // Created three days before the hold was set: created_at + 24h would be
  // long past.
  created_at: "2026-11-01T10:00:00.000Z",
  subtotal_cents: 50000,
  shipping_cents: 0,
  total_cents: 50000,
  currency: "USD",
};

async function render() {
  return renderToStaticMarkup(await CompleteOrderPage({ params: Promise.resolve({ id: ORDER.id }) }));
}

beforeEach(() => {
  mocks.rows.clear();
  mocks.rows.set("orders", { data: ORDER, error: null });
  mocks.rows.set("order_items", { data: [{ id: "item-1", listing_id: "listing-1", title: "Turbo manifold", price_cents: 50000 }], error: null });
  mocks.rows.set("profiles", { data: { display_name: "Kaito", username: "kaito" }, error: null });
  mocks.rows.set("listing_images", { data: [], error: null });
  mocks.rows.set("offer_rounds", { data: [], error: null });
});

describe("accepted-offer hold countdown", () => {
  it("renders the persisted hold expiry, not 24 hours from creation", async () => {
    mocks.rows.set("listings", {
      data: [{ id: "listing-1", allows_collection: false, reserved_until: "2026-11-05T18:30:00.000Z" }],
      error: null,
    });
    const html = await render();
    expect(html).toContain('dateTime="2026-11-05T18:30:00.000Z"');
    expect(html).not.toContain("2026-11-02T10:00:00.000Z");
  });

  it("promises no time when the hold can't be read", async () => {
    mocks.rows.set("listings", { data: [{ id: "listing-1", allows_collection: false, reserved_until: null }], error: null });
    const html = await render();
    expect(html).not.toContain("The hold releases");
    expect(html).not.toContain("<time");
  });
});

describe("reservationHoldEndsAt", () => {
  it("is the earliest valid reservation among the order's parts", () => {
    expect(
      reservationHoldEndsAt([
        { reserved_until: "2026-11-06T12:00:00.000Z" },
        { reserved_until: null },
        { reserved_until: "not a date" },
        { reserved_until: "2026-11-05T12:00:00.000Z" },
      ])?.toISOString(),
    ).toBe("2026-11-05T12:00:00.000Z");
    expect(reservationHoldEndsAt([])).toBeNull();
  });
});
