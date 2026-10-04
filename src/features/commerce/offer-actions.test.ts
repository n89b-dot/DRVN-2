import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  offer: vi.fn(),
  listing: vi.fn(),
  order: vi.fn(),
  updateResult: vi.fn(),
  inStatuses: vi.fn(),
  rpc: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ RATE_LIMITS: {}, allowAction: vi.fn(), rateLimitMessage: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/beta-access", () => ({ getBetaAccess: vi.fn().mockResolvedValue({ eligible: true }), betaCommerceError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.auth } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => ({
      insert: mocks.insert,
      select: () => ({ eq: () => ({ maybeSingle: table === "offers" ? mocks.offer : table === "orders" ? mocks.order : mocks.listing }) }),
      update: () => ({
        eq: () => ({
          in: (_column: string, statuses: string[]) => {
            mocks.inStatuses(statuses);
            return { select: mocks.updateResult };
          },
          eq: (_column: string, status: string) => {
            mocks.inStatuses([status]);
            return { select: mocks.updateResult };
          },
        }),
      }),
    }),
  }),
}));

import { respondToOffer } from "./offer-actions";

function decisionForm(decision: "declined" | "countered") {
  const data = new FormData();
  data.set("offer_id", "offer-1");
  data.set("decision", decision);
  if (decision === "countered") data.set("counter_amount", "15");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ data: { user: { id: "seller-1" } } });
  mocks.offer.mockResolvedValue({ data: { id: "offer-1", listing_id: "listing-1", buyer_id: "buyer-1", amount_cents: 1000, counter_amount_cents: null, status: "open", expires_at: null } });
  mocks.listing.mockResolvedValue({ data: { id: "listing-1", seller_id: "seller-1", status: "active", price_cents: 2000 } });
  mocks.order.mockResolvedValue({ data: null });
  mocks.updateResult.mockResolvedValue({ data: [], error: null });
  mocks.rpc.mockResolvedValue({ data: "order-1", error: null });
  mocks.insert.mockResolvedValue({ error: null });
});

it("does not overwrite an offer accepted while a decline was waiting", async () => {
  const result = await respondToOffer({}, decisionForm("declined"));
  expect(result.error).toContain("already been settled");
  expect(mocks.inStatuses).toHaveBeenCalledWith(["open", "countered"]);
});

it("does not overwrite an offer accepted while a counter was waiting", async () => {
  const result = await respondToOffer({}, decisionForm("countered"));
  expect(result.error).toContain("already been settled");
  expect(mocks.inStatuses).toHaveBeenCalledWith(["open"]);
});

const countered = { id: "offer-1", listing_id: "listing-1", buyer_id: "buyer-1", amount_cents: 1000, counter_amount_cents: 1500, status: "countered", expires_at: null };

it("refuses a seller accepting their own counter — it's the buyer's turn", async () => {
  mocks.offer.mockResolvedValue({ data: countered });
  const data = new FormData();
  data.set("offer_id", "offer-1");
  data.set("decision", "accepted");
  const result = await respondToOffer({}, data);
  expect(result.error).toContain("buyer's turn");
  expect(mocks.inStatuses).not.toHaveBeenCalled();
});

it("refuses a second counter while the first is waiting on the buyer", async () => {
  mocks.offer.mockResolvedValue({ data: countered });
  const data = decisionForm("countered");
  data.set("counter_amount", "18");
  const result = await respondToOffer({}, data);
  expect(result.error).toContain("buyer's turn");
  expect(mocks.inStatuses).not.toHaveBeenCalled();
});

it("lets a seller pass on an offer they countered", async () => {
  mocks.offer.mockResolvedValue({ data: countered });
  mocks.updateResult.mockResolvedValue({ data: [{ id: "offer-1" }], error: null });
  await expect(respondToOffer({}, decisionForm("declined"))).resolves.toEqual({ ok: "Offer declined." });
});

it("confirms an exact decline replay after its response was lost", async () => {
  mocks.offer.mockResolvedValue({ data: { id: "offer-1", listing_id: "listing-1", buyer_id: "buyer-1", amount_cents: 1000, counter_amount_cents: null, status: "declined", expires_at: null } });
  await expect(respondToOffer({}, decisionForm("declined"))).resolves.toEqual({ ok: "Offer declined." });
  expect(mocks.inStatuses).not.toHaveBeenCalled();
});

it("confirms an exact counter replay without changing it again", async () => {
  mocks.offer.mockResolvedValue({ data: { id: "offer-1", listing_id: "listing-1", buyer_id: "buyer-1", amount_cents: 1000, counter_amount_cents: 1500, status: "countered", expires_at: null } });
  await expect(respondToOffer({}, decisionForm("countered"))).resolves.toEqual({ ok: "Counter sent." });
  expect(mocks.inStatuses).not.toHaveBeenCalled();
});

it("confirms an exact counter replay after the current asking price changed", async () => {
  mocks.offer.mockResolvedValue({ data: { id: "offer-1", listing_id: "listing-1", buyer_id: "buyer-1", amount_cents: 1000, counter_amount_cents: 1500, status: "countered", expires_at: null } });
  mocks.listing.mockResolvedValue({ data: { id: "listing-1", seller_id: "seller-1", status: "active", price_cents: 1200 } });
  await expect(respondToOffer({}, decisionForm("countered"))).resolves.toEqual({ ok: "Counter sent." });
  expect(mocks.inStatuses).not.toHaveBeenCalled();
});

it("confirms an accepted offer replay only when its order exists", async () => {
  mocks.offer.mockResolvedValue({ data: { id: "offer-1", listing_id: "listing-1", buyer_id: "buyer-1", amount_cents: 1000, counter_amount_cents: null, status: "accepted", expires_at: null } });
  mocks.order.mockResolvedValue({ data: { id: "order-1" } });
  const data = new FormData();
  data.set("offer_id", "offer-1");
  data.set("decision", "accepted");
  await expect(respondToOffer({}, data)).resolves.toEqual({ ok: "Offer accepted — the buyer has 24 hours to complete checkout." });
});

function acceptForm() {
  const data = new FormData();
  data.set("offer_id", "offer-1");
  data.set("decision", "accepted");
  return data;
}

it("tells the seller when the buyer couldn't be notified of an acceptance", async () => {
  mocks.order.mockResolvedValue({ data: { buyer_id: "buyer-1", seller_id: "seller-1" }, error: null });
  mocks.insert.mockResolvedValue({ error: { message: "timeout" } });
  const result = await respondToOffer({}, acceptForm());
  // The acceptance itself stands: the order was reserved.
  expect(result.ok).toMatch(/^Offer accepted\. We couldn't notify the buyer/);
  expect(result.error).toBeUndefined();
});

it("confirms an acceptance whose notice went out", async () => {
  mocks.order.mockResolvedValue({ data: { buyer_id: "buyer-1", seller_id: "seller-1" }, error: null });
  await expect(respondToOffer({}, acceptForm())).resolves.toEqual({
    ok: "Offer accepted — the buyer has 24 hours to complete checkout.",
  });
});
