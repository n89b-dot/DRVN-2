import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  offer: vi.fn(),
  listing: vi.fn(),
  updateResult: vi.fn(),
  inStatuses: vi.fn(),
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
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: table === "offers" ? mocks.offer : mocks.listing }) }),
      update: () => ({
        eq: () => ({
          in: (_column: string, statuses: string[]) => {
            mocks.inStatuses(statuses);
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
  mocks.offer.mockResolvedValue({ data: { id: "offer-1", listing_id: "listing-1", buyer_id: "buyer-1", amount_cents: 1000, status: "open", expires_at: null } });
  mocks.listing.mockResolvedValue({ data: { id: "listing-1", seller_id: "seller-1", status: "active", price_cents: 2000 } });
  mocks.updateResult.mockResolvedValue({ data: [], error: null });
});

it("does not overwrite an offer accepted while a decline was waiting", async () => {
  const result = await respondToOffer({}, decisionForm("declined"));
  expect(result.error).toContain("already been settled");
  expect(mocks.inStatuses).toHaveBeenCalledWith(["open", "countered"]);
});

it("does not overwrite an offer accepted while a counter was waiting", async () => {
  const result = await respondToOffer({}, decisionForm("countered"));
  expect(result.error).toContain("already been settled");
  expect(mocks.inStatuses).toHaveBeenCalledWith(["open", "countered"]);
});
