import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N77 (OS-W33, Neil's ruling: withdraw, don't delete). A listing with offers
 * is withdrawn through withdraw_listing (20261107220700), never deleted; the
 * delete guard's refusal (LW409) turns the dialog into Withdraw.
 */
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  deleteError: null as { code: string; message: string } | null,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error(`redirect ${to}`), { digest: `NEXT_REDIRECT;${to}` });
  },
}));
vi.mock("@/lib/revalidate", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/payments/connect", () => ({ sellerCanPublish: async () => true }));
vi.mock("@/lib/media-lifecycle", () => ({ deleteMediaIfUnreferenced: vi.fn(), finalizeMediaUrls: vi.fn(), scheduleMediaCleanup: vi.fn() }));
vi.mock("@/lib/listing-import/consume", () => ({ consumeListingImport: vi.fn() }));
vi.mock("@/features/agent/actions", () => ({ saveListingAgent: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "seller" } } }) },
    rpc: (...args: unknown[]) => Promise.resolve(state.rpc(...args)),
    from: () => {
      const query = {
        delete: () => query,
        eq: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: state.deleteError }).then(resolve),
      };
      return query;
    },
  }),
}));

import { deleteListing, withdrawListing } from "./actions";

function form(id = "listing-1") {
  const data = new FormData();
  data.set("id", id);
  return data;
}

beforeEach(() => {
  state.rpc.mockReset();
  state.deleteError = null;
});

describe("N77 withdraw, don't delete", () => {
  it("withdraws through the one database step and says the buyers were told", async () => {
    state.rpc.mockReturnValue({ data: { outcome: "withdrawn", offers_ended: 2 }, error: null });
    const result = await withdrawListing(null, form());
    expect(state.rpc).toHaveBeenCalledWith("withdraw_listing", { p_listing: "listing-1" });
    expect(result?.ok).toBe("Withdrawn. 2 open offers ended, and the buyers were told.");
  });

  it("leaves a reserved or sold listing to its order", async () => {
    state.rpc.mockReturnValue({ data: null, error: { code: "LW423", message: "x" } });
    expect((await withdrawListing(null, form()))?.error).toContain("mid-checkout or sold");
  });

  it("turns a delete of a listing with offers into a withdraw, never deleting it", async () => {
    state.deleteError = { code: "LW409", message: "This listing has offers." };
    const result = await deleteListing(null, form());
    expect(result).toMatchObject({ withdrawInstead: true });
    expect(result?.error).toContain("withdrawn instead of deleted");
  });
});
