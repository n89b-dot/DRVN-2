import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));

import { markAllNotificationsRead, markNotificationRead } from "./actions";

function chain(result: { data: unknown; error: unknown }, singleResult = result) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "update", "eq", "is"]) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => singleResult);
  builder.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(resolve(result));
  return builder;
}

describe("notification read actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("returns the destination only after the unread row is persistently updated", async () => {
    const lookup = chain({ data: null, error: null }, { data: { href: "/orders/1", read_at: null }, error: null });
    const update = chain({ data: [{ id: "notice-1" }], error: null }, { data: { id: "notice-1" }, error: null });
    mocks.from.mockReturnValueOnce(lookup).mockReturnValueOnce(update);

    await expect(markNotificationRead("notice-1")).resolves.toEqual({ href: "/orders/1" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/notifications");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("keeps navigation on notifications and exposes feedback when persistence fails", async () => {
    const lookup = chain({ data: null, error: null }, { data: { href: "/orders/1", read_at: null }, error: null });
    const update = chain({ data: null, error: { message: "write failed" } }, { data: null, error: { message: "write failed" } });
    mocks.from.mockReturnValueOnce(lookup).mockReturnValueOnce(update);

    await expect(markNotificationRead("notice-1")).resolves.toEqual({ error: "write_failed" });
    expect(mocks.reportError).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns the persisted mark-all count and reports a failed batch", async () => {
    mocks.from.mockReturnValueOnce(chain({ data: [{ id: "1" }, { id: "2" }], error: null }));
    await expect(markAllNotificationsRead()).resolves.toEqual({ marked: 2 });

    mocks.from.mockReturnValueOnce(chain({ data: null, error: { message: "write failed" } }));
    await expect(markAllNotificationsRead()).resolves.toEqual({ error: "Couldn't mark notifications as read. Try again." });
    expect(mocks.reportError).toHaveBeenCalledOnce();
  });
});
