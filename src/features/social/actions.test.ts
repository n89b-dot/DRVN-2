import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));

import { removeFollow, removeSave, toggleFollow, toggleLike, toggleSave } from "./actions";

describe("social relationship actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("sends the desired state so repeated save, like, and follow requests converge", async () => {
    mocks.rpc.mockImplementation(async (_name, args: { p_active: boolean }) => ({ data: args.p_active, error: null }));

    await expect(toggleSave("car", "target-1", "/home", true)).resolves.toEqual({ saved: true });
    await expect(toggleSave("car", "target-1", "/home", true)).resolves.toEqual({ saved: true });
    await expect(toggleLike("car", "target-1", "/home", false)).resolves.toEqual({ liked: false });
    await expect(toggleFollow("car", "target-1", "/home", true)).resolves.toEqual({ following: true });

    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_active)).toEqual([true, true, false, true]);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(4);
  });

  it("returns stable user feedback and does not revalidate after a failed write", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });

    await expect(toggleSave("listing", "target-1", "/marketplace", true)).resolves.toEqual({ error: "Couldn't update that. Try again." });
    expect(mocks.reportError).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("uses the same idempotent write for saved-page removals", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const save = new FormData();
    save.set("target_type", "post");
    save.set("target_id", "target-1");
    const follow = new FormData();
    follow.set("target_type", "profile");
    follow.set("target_id", "target-2");

    await expect(removeSave({}, save)).resolves.toEqual({});
    await expect(removeFollow({}, follow)).resolves.toEqual({});
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_active)).toEqual([false, false]);
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(1, "/saved");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(2, "/saved");
  });
});
