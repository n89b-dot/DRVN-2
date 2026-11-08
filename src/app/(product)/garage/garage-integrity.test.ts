import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), refresh: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/media-lifecycle", () => ({
  deleteMediaIfUnreferenced: vi.fn(),
  finalizeMediaUrls: vi.fn(),
  scheduleMediaCleanup: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: { id: "car", slug: "car", owner_id: "owner" }, error: null }),
      };
      return query;
    },
    rpc: (...args: unknown[]) => Promise.resolve(mocks.rpc(...args)),
  }),
}));

import { STALE_MOD_SHEET } from "@/lib/mods/sheet-revision";

import { confirmLostModSave, saveModItems, saveShowcase } from "./actions";

const line = {
  id: "12345678-1234-4234-8234-123456789012",
  group_label: "Engine",
  brand: "HKS",
  product: "Intake",
  raw_text: "HKS Intake",
  position: 0,
};

beforeEach(() => vi.clearAllMocks());

describe("N65 a stale build sheet can't overwrite a newer one", () => {
  it("sends the revision the editor loaded and hands back the new one", async () => {
    mocks.rpc.mockReturnValue({ data: { outcome: "saved", revision: "rev-2" }, error: null });
    const result = await saveModItems("car", [line], "rev-1");
    expect(mocks.rpc).toHaveBeenCalledWith("save_mod_items", expect.objectContaining({ p_car_id: "car", p_expected_revision: "rev-1" }));
    expect(result).toMatchObject({ ok: "Build saved.", revision: "rev-2" });
  });

  it("says the build changed, and asks for a reload, when the database refuses a stale save", async () => {
    mocks.rpc.mockReturnValue({ data: null, error: { code: "40001", hint: "stale_mod_sheet", message: "x" } });
    expect(await saveModItems("car", [line], "rev-old")).toEqual({ error: STALE_MOD_SHEET, stale: true });
  });

  it("after a lost response, asks whether the sheet is exactly what that save sent, in the same shape it was saved", async () => {
    mocks.rpc.mockReturnValue({ data: { outcome: "saved", revision: "rev-2" }, error: null });
    await saveModItems("car", [line], "rev-1");
    const saved = (mocks.rpc.mock.calls[0][1] as { p_items: unknown }).p_items;
    mocks.rpc.mockReturnValue({ data: "rev-2", error: null });
    expect(await confirmLostModSave("car", [line])).toBe("rev-2");
    expect(mocks.rpc).toHaveBeenLastCalledWith("mod_sheet_revision_if_matches", { p_car: "car", p_items: saved });
    mocks.rpc.mockReturnValue({ data: null, error: null });
    expect(await confirmLostModSave("car", [line])).toBeNull();
  });

  it("refuses to save with no revision at all", async () => {
    expect((await saveModItems("car", [line], "")).error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("N66 the showcase is replaced in one database call", () => {
  it("never deletes pins in one request and inserts them in another", async () => {
    mocks.rpc.mockReturnValue({ data: 1, error: null });
    const result = await saveShowcase("car", "https://x/photo.jpg", [{ x: 0.5, y: 0.25, modItemId: null, label: " Intake " }]);
    expect(result.ok).toBe("Showcase saved");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("replace_car_showcase", {
      p_car: "car",
      p_image_url: "https://x/photo.jpg",
      p_pins: [{ x: 0.5, y: 0.25, mod_item_id: null, label: "Intake" }],
    });
  });

  it("tells the member the old showcase is untouched when the save fails", async () => {
    mocks.rpc.mockReturnValue({ data: null, error: { code: "XX000", message: "boom" } });
    expect((await saveShowcase("car", "u", [{ x: 0.1, y: 0.1, modItemId: null, label: "a" }])).error).toContain("previous one is unchanged");
  });
});
