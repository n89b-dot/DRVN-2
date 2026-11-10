import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  existing: vi.fn(),
  live: vi.fn(),
  listing: vi.fn(),
  rpc: vi.fn(),
  allow: vi.fn(),
  ageGate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/age-gate", () => ({ requireAgeConfirmed: mocks.ageGate }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { makeOffer: {} },
  allowAction: mocks.allow,
  rateLimitMessage: () => "limited",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.auth },
    from: (table: string) => ({
      // One chain for every read: a single .eq() on offers is the idempotency
      // lookup by id; more filters on offers is the buyer's live-offer check.
      select: () => {
        let filters = 0;
        const chain = {
          eq: () => { filters++; return chain; },
          in: () => { filters++; return chain; },
          neq: () => chain,
          limit: () => chain,
          maybeSingle: () => (table !== "offers" ? mocks.listing() : filters > 1 ? mocks.live() : mocks.existing()),
        };
        return chain;
      },
    }),
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { makeOffer } from "./offer-actions";

const offerId = "30000000-0000-4000-8000-000000000001";
function form(message = "Opening note") {
  const data = new FormData();
  data.set("offer_id", offerId);
  data.set("listing_id", "listing-1");
  data.set("amount", "90.00");
  data.set("message", message);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ data: { user: { id: "buyer-1" } } });
  mocks.existing.mockResolvedValue({ data: null, error: null });
  mocks.live.mockResolvedValue({ data: null, error: null });
  mocks.listing.mockResolvedValue({ data: {
    seller_id: "seller-1",
    status: "active",
    price_cents: 10000,
    shipping_mode: "seller",
  }, error: null });
  mocks.allow.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ data: { offer_id: offerId, replayed: false, outcome: "sent" }, error: null });
});

it("N662: a member who still owes the 18+ answer makes no offer until they confirm", async () => {
  mocks.ageGate.mockRejectedValueOnce(new Error("NEXT_REDIRECT;/confirm-age"));
  await expect(makeOffer({}, form())).rejects.toThrow("NEXT_REDIRECT");
  expect(mocks.ageGate).toHaveBeenCalledWith(expect.objectContaining({ id: "buyer-1" }));
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.allow).not.toHaveBeenCalled();
});

it("creates the offer and opening message through one atomic RPC", async () => {
  expect(form().get("offer_id")).toBe(offerId);
  await expect(makeOffer({}, form())).resolves.toMatchObject({ ok: expect.stringContaining("Offer sent") });
  expect(mocks.rpc).toHaveBeenCalledWith("offer_open", {
    p_offer: offerId,
    p_listing: "listing-1",
    p_amount: 9000,
    p_message: "Opening note",
  });
});

it("replays the same committed identity without consuming admission again", async () => {
  mocks.existing.mockResolvedValue({ data: { id: offerId }, error: null });
  mocks.rpc.mockResolvedValue({ data: { offer_id: offerId, replayed: true, outcome: "sent" }, error: null });
  await expect(makeOffer({}, form())).resolves.toHaveProperty("ok");
  expect(mocks.allow).not.toHaveBeenCalled();
  expect(mocks.listing).not.toHaveBeenCalled();
});

it("holds an uncertain RPC outcome for an exact retry", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "connection closed" } });
  await expect(makeOffer({}, form())).resolves.toEqual({
    error: "Couldn't confirm your offer was sent. Try again with the same offer.",
  });
});

it("never calls the database mutation without a valid stable identity", async () => {
  const data = form();
  data.set("offer_id", "not-a-uuid");
  await expect(makeOffer({}, data)).resolves.toHaveProperty("error");
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("says so plainly when the buyer already has a live offer on the part", async () => {
  mocks.live.mockResolvedValue({ data: { id: "other-offer" }, error: null });
  const result = await makeOffer({}, form());
  expect(result.error).toBe("You already have an open offer on this part — find it in Offers.");
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("refuses a below-minimum offer without naming the minimum", async () => {
  // offer_open records the attempt as a declined round (it uses one of the
  // buyer's 3) and answers normally, so nothing is rolled back.
  mocks.rpc.mockResolvedValue({ data: { offer_id: offerId, replayed: false, outcome: "below_minimum" }, error: null });
  const result = await makeOffer({}, form());
  expect(result.error).toBe("That's lower than the seller will accept. Try a higher offer.");
  expect(result.error).not.toMatch(/\$|\d/);
});

it("says so when the buyer has used their 3 offers on the part", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "OF001" } });
  await expect(makeOffer({}, form())).resolves.toEqual({ error: "You've used your 3 offers on this part." });
});
