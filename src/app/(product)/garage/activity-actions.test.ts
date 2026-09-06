import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  finalize: vi.fn(),
  refresh: vi.fn(),
  reportError: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ capture: mocks.capture }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@/lib/media-lifecycle", () => ({
  deleteMediaIfUnreferenced: vi.fn(),
  finalizeMediaUrls: mocks.finalize,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const carQuery = {
      select: () => carQuery,
      eq: () => carQuery,
      single: async () => ({ data: { id: "car", slug: "activity-car", owner_id: "owner" }, error: null }),
    };
    return {
      auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
      from: () => carQuery,
      rpc: (...args: unknown[]) => ({
        single: async () => mocks.rpc(...args),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.rpc(...args)).then(resolve),
      }),
    };
  },
}));

import { createRichActivityPost, saveActivityDraft } from "./actions";

const OPERATION_ID = "12345678-1234-4234-8234-123456789012";
const blocks = [{ type: "text", style: "normal", text: "A durable update" }];

function form() {
  const data = new FormData();
  data.set("car_id", "car");
  data.set("operation_id", OPERATION_ID);
  data.set("title", "Durable activity");
  data.set("blocks", JSON.stringify(blocks));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { post_id: "post", outcome: "published" }, error: null });
});

describe("durable activity actions", () => {
  it("publishes with the stable operation UUID and returns navigation only after SQL confirms", async () => {
    await expect(createRichActivityPost({}, form())).resolves.toEqual({
      ok: "Published.",
      href: "/cars/activity-car/activity/post",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("write_activity_post", expect.objectContaining({
      p_mode: "publish",
      p_post_id: OPERATION_ID,
      p_car_id: "car",
      p_title: "Durable activity",
      p_body: blocks,
    }));
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledWith("/cars/activity-car");
  });

  it("keeps a failed publish retryable and does not emit success side effects", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });

    const result = await createRichActivityPost({}, form());
    expect(result.error).toContain("same draft");
    expect(result).not.toHaveProperty("href");
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("autosaves through the same atomic writer with the same operation identity", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ post_id: "post", outcome: "draft_saved" }], error: null });

    await expect(saveActivityDraft({}, form())).resolves.toEqual({ ok: "Draft saved" });
    expect(mocks.rpc).toHaveBeenCalledWith("write_activity_post", expect.objectContaining({
      p_mode: "draft",
      p_post_id: OPERATION_ID,
      p_car_id: "car",
      p_body: blocks,
    }));
  });

  it("rejects a missing operation identity before any write", async () => {
    const data = form();
    data.delete("operation_id");

    expect((await createRichActivityPost({}, data)).error).toContain("Refresh");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
