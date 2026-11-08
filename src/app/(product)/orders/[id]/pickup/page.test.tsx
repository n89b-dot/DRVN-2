import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

/**
 * The Pickup Pass scan page (Codex fix-check of #108): a disputed collection
 * never handed over offers the handoff, as pickup_redeem allows; never while
 * a bank chargeback is unresolved; a handoff already recorded in the case
 * reads as done.
 */

const mocks = vi.hoisted(() => ({
  order: null as Record<string, unknown> | null,
  journal: [] as { state: string }[],
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "seller" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.order, error: null }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ contains: async () => ({ data: mocks.journal, error: null }) }) }),
  }),
}));
vi.mock("../pickup-controls", () => ({ RedeemPickupForm: () => <form data-form="redeem" /> }));

const { default: PickupRedeemPage } = await import("./page");

const render = async () =>
  renderToStaticMarkup(
    await PickupRedeemPage({ params: Promise.resolve({ id: "order-1" }), searchParams: Promise.resolve({ token: "tok" }) })
  );

const base = { id: "order-1", seller_id: "seller", is_collection: true, pickup_ready_at: "2026-11-07T10:00:00Z" };

beforeEach(() => {
  mocks.journal = [];
});

it("offers the handoff for a paid collection", async () => {
  mocks.order = { ...base, status: "paid", pre_dispute_status: null };
  expect(await render()).toContain('data-form="redeem"');
});

it("offers the handoff for a disputed collection never handed over, and says the case stays open", async () => {
  mocks.order = { ...base, status: "disputed", pre_dispute_status: "paid" };
  const html = await render();
  expect(html).toContain('data-form="redeem"');
  expect(html).toContain("stays open");
});

it("withholds it while a bank chargeback is unresolved", async () => {
  mocks.order = { ...base, status: "disputed", pre_dispute_status: "paid" };
  mocks.journal = [{ state: "open" }];
  const html = await render();
  expect(html).not.toContain('data-form="redeem"');
  expect(html).toContain("isn&#x27;t waiting for a pickup handoff");
});

it("reads a handoff already recorded in the case as done", async () => {
  mocks.order = { ...base, status: "disputed", pre_dispute_status: "delivered" };
  const html = await render();
  expect(html).not.toContain('data-form="redeem"');
  expect(html).toContain("already confirmed");
});
