import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N72 — a refused create-listing must not trap the seller: the database's
 * bounds are checked before anything is claimed, a refusal after the claim
 * gives the claim back, and the seller's next, changed request (the
 * suggested "save as draft") goes through on the same form. The database's
 * own refusals (20261107210000) come back in the seller's words.
 */

const SELLER = "00000000-0000-4000-8000-000000000001";
const REQUEST = "11111111-1111-4111-8111-111111111111";
const LISTING = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  canPublish: true,
  saveError: null as { code: string; message: string } | null,
  owesAge: false,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect ${to}`), { digest: `NEXT_REDIRECT;${to}` });
  },
}));
vi.mock("@/lib/revalidate", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/age-gate", () => ({
  requireAgeConfirmed: async () => {
    if (state.owesAge) throw Object.assign(new Error("redirect /confirm-age"), { digest: "NEXT_REDIRECT;/confirm-age" });
  },
}));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/payments/connect", () => ({ sellerCanPublish: async () => state.canPublish }));
vi.mock("@/lib/rate-limit", () => ({ RATE_LIMITS: { createListing: {} }, allowAction: async () => true, rateLimitMessage: () => "slow down" }));
vi.mock("@/lib/media-lifecycle", () => ({
  deleteMediaIfUnreferenced: vi.fn(),
  finalizeMediaUrls: vi.fn(),
  scheduleMediaCleanup: vi.fn(),
}));
vi.mock("@/lib/media-url", () => ({
  keepValidGalleryImages: (values: unknown) => (Array.isArray(values) ? values : []),
}));
vi.mock("@/lib/listing-import/consume", () => ({ consumeListingImport: vi.fn() }));
vi.mock("@/features/agent/actions", () => ({ saveListingAgent: vi.fn() }));
vi.mock("@/features/commerce/fulfillment", () => ({ fulfillmentProfileReady: () => true, loadFulfillmentProfile: vi.fn() }));
vi.mock("@/lib/shipping/provider", () => ({ integratedShippingEnabled: () => false }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: SELLER } } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      if (name === "claim_listing_creation") return { data: { listing_id: LISTING, completed: false, fresh: true }, error: null };
      if (name === "discard_listing_creation") return { data: true, error: null };
      if (name === "save_listing_creation") {
        return state.saveError
          ? { data: null, error: state.saveError }
          : { data: { listing_id: LISTING, completed: true, replayed: false }, error: null };
      }
      return { data: null, error: null };
    },
  }),
}));

const { createListing, setListingStatus, updateListing } = await import("./actions");
const { PAYOUTS_REQUIRED, PHOTO_REQUIRED } = await import("./listing-refusal");

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields: Record<string, string> = {
    title: "Garrett G25-660",
    category: "performance",
    price: "900",
    shipping: "25",
    condition: "new",
    request_id: REQUEST,
    image_urls: JSON.stringify([{ url: `https://proj.supabase.co/storage/v1/object/public/listing-images/${SELLER}/a.webp`, alt: null }]),
    ...overrides,
  };
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const names = () => state.calls.map((call) => call.name);

beforeEach(() => {
  state.calls = [];
  state.canPublish = true;
  state.saveError = null;
  state.owesAge = false;
});

describe("N662: the 18+ confirmation holds listing a part", () => {
  it("a member who still owes the answer creates, edits and publishes nothing until they confirm", async () => {
    state.owesAge = true;
    await expect(createListing({}, form())).rejects.toThrow("redirect /confirm-age");
    const edit = form({ id: LISTING });
    await expect(updateListing({}, edit)).rejects.toThrow("redirect /confirm-age");
    const publish = new FormData();
    publish.set("id", LISTING);
    publish.set("status", "active");
    await expect(setListingStatus(null, publish)).rejects.toThrow("redirect /confirm-age");
    expect(names()).toEqual([]);
  });
});

describe("createListing refusals (N72)", () => {
  it("refuses a location or shipping the database would refuse, before claiming anything", async () => {
    expect(await createListing({}, form({ location: "x".repeat(121) }))).toEqual({
      error: "Keep the location under 120 characters.",
    });
    expect(await createListing({}, form({ shipping: "100000.01" }))).toEqual({
      error: "Shipping can't be more than $100,000.",
    });
    expect(names()).toEqual([]);
  });

  it("gives the claim back when payouts refuse the publish, and lets the same form save a draft", async () => {
    state.canPublish = false;
    expect(await createListing({}, form())).toEqual({ error: PAYOUTS_REQUIRED });
    expect(names()).toEqual(["claim_listing_creation", "discard_listing_creation"]);
    const [claim, discard] = state.calls;
    expect(discard.args).toEqual({ p_request: REQUEST, p_payload_hash: claim.args.p_payload_hash });

    // The suggested next step, on the same request id: a changed payload.
    state.calls = [];
    await expect(createListing({}, form({ save_draft: "1" }))).rejects.toThrow(`redirect /listings/${LISTING}/edit?saved=draft`);
    expect(names()).toEqual(["claim_listing_creation", "save_listing_creation"]);
    expect(state.calls[0].args.p_request).toBe(REQUEST);
    expect(state.calls[0].args.p_payload_hash).not.toBe(claim.args.p_payload_hash);
    expect((state.calls[1].args.p_listing as { status: string }).status).toBe("draft");
  });

  it("says what the database refused, in the seller's words", async () => {
    state.saveError = { code: "LS001", message: "Publishing needs payouts set up first" };
    expect(await createListing({}, form())).toEqual({ error: PAYOUTS_REQUIRED });
    state.saveError = { code: "23514", message: "A live listing needs at least one photo" };
    expect(await createListing({}, form())).toEqual({ error: PHOTO_REQUIRED });
    state.saveError = { code: "XX000", message: "boom" };
    expect((await createListing({}, form())).error).toMatch(/Your form is still here/);
  });
});
