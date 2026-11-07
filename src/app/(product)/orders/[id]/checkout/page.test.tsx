import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Readiness 65 (PRD AG-4): an order that came from an offer says when an
 * agent set the price, on both of its checkout surfaces — the money block
 * and the review right before payment — worked out from the offer's
 * recorded rounds, never from a guess.
 */

const mocks = vi.hoisted(() => ({
  rows: new Map<string, { data: unknown; error: unknown }>(),
  steps: vi.fn(),
}));

function query(table: string) {
  const result = () => mocks.rows.get(table) ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "order"]) builder[method] = () => builder;
  builder.maybeSingle = async () => result();
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
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
vi.mock("@/components/livesheet", () => ({ Rv: ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div> }));
vi.mock("@/app/(discover)/checkout/checkout-steps", () => ({
  CheckoutSteps: (props: { priceNote?: string | null }) => {
    mocks.steps(props);
    return <div data-review-note={props.priceNote ?? ""} />;
  },
}));

const { default: CompleteOrderPage } = await import("./page");

const ORDER = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  buyer_id: "buyer-1",
  seller_id: "seller-1",
  seller_label: null,
  status: "pending",
  origin_offer_id: "offer-1",
  created_at: "2026-11-01T10:00:00.000Z",
  subtotal_cents: 128000,
  shipping_cents: 0,
  total_cents: 128000,
  currency: "USD",
};

const round = (round_no: number, actor_role: string, kind: string, amount_cents: number | null, agent: { task?: boolean; version?: boolean } = {}) => ({
  round_no,
  actor_role,
  kind,
  amount_cents,
  created_at: `2026-11-0${round_no}T10:00:00.000Z`,
  actor_task_id: agent.task ? `task-${round_no}` : null,
  mandate_version: agent.version || agent.task ? 1 : null,
});

async function render() {
  return renderToStaticMarkup(await CompleteOrderPage({ params: Promise.resolve({ id: ORDER.id }) }));
}

beforeEach(() => {
  mocks.rows.clear();
  mocks.steps.mockClear();
  mocks.rows.set("orders", { data: ORDER, error: null });
  mocks.rows.set("order_items", { data: [{ id: "i-1", listing_id: null, title: "Turbo", price_cents: 128000 }], error: null });
  mocks.rows.set("profiles", { data: { display_name: "Kaito", username: "kaito" }, error: null });
  mocks.rows.set("listing_images", { data: [], error: null });
  mocks.rows.set("listings", { data: [], error: null });
});

describe("/orders/[id]/checkout (readiness 65)", () => {
  it("says the buyer's agent set the price, in the money block and the payment review", async () => {
    mocks.rows.set("offer_rounds", {
      data: [round(1, "buyer", "offer", 105000, { task: true }), round(2, "seller", "counter", 128000), round(3, "buyer", "accept", null, { task: true })],
      error: null,
    });
    const html = await render();
    expect(html).toMatch(/Price set by your agent on [^<]+, within the max you set\./);
    const note = mocks.steps.mock.calls[0][0].priceNote as string;
    expect(note).toMatch(/^Price set by your agent on .+, within the max you set\.$/);
    expect(html).toContain(`data-review-note="${note}"`);
  });

  it("still knows it was an agent after the task link has cleared", async () => {
    // actor_task_id clears when the agent's task is deleted; the mandate
    // version the move was made under stays on the round.
    mocks.rows.set("offer_rounds", {
      data: [round(1, "buyer", "offer", 105000), round(2, "seller", "counter", 128000, { version: true }), round(3, "buyer", "accept", null)],
      error: null,
    });
    const html = await render();
    expect(html).toMatch(/Price agreed with the seller&#x27;s agent on [^<]+\./);
    expect(mocks.steps.mock.calls[0][0].priceNote).toMatch(/^Price agreed with the seller's agent on /);
  });

  it("says nothing when people set the price", async () => {
    mocks.rows.set("offer_rounds", { data: [round(1, "buyer", "offer", 128000), round(2, "seller", "accept", null)], error: null });
    const html = await render();
    expect(html).not.toMatch(/agent/i);
    expect(mocks.steps.mock.calls[0][0].priceNote).toBeUndefined();
  });

  it("does not quietly drop the line when the rounds can't be read", async () => {
    mocks.rows.set("offer_rounds", { data: null, error: { code: "57014" } });
    await expect(render()).rejects.toThrow("Could not load this order's negotiation");
  });
});
