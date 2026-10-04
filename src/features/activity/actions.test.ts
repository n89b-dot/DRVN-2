import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowAction: vi.fn(),
  insert: vi.fn(),
  existing: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/suspension", () => ({ SUSPENDED_MESSAGE: "suspended", isSuspended: vi.fn(async () => false) }));
vi.mock("@/lib/rate-limit", () => ({
  allowAction: mocks.allowAction,
  rateLimitMessage: () => "slow down",
  RATE_LIMITS: { addComment: { action: "comment" }, react: { action: "react" } },
}));
vi.mock("@/lib/supabase/server", () => {
  // Every filter returns the same chain; the terminal calls are what matter.
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "delete"]) chain[name] = () => chain;
  chain.maybeSingle = () => mocks.existing();
  chain.insert = (row: unknown) => mocks.insert(row);
  chain.then = (resolve: (value: unknown) => void) => resolve({ error: null });
  return {
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => chain,
    }),
  };
});

const { addComment, toggleReaction } = await import("./actions");

function reply(body: string) {
  const form = new FormData();
  form.set("post_id", "post-1");
  form.set("body", body);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowAction.mockResolvedValue(true);
  mocks.insert.mockResolvedValue({ error: null });
  mocks.existing.mockResolvedValue({ data: null });
});

describe("comment throttling", () => {
  it("counts each reply against the member's comment limit", async () => {
    await expect(addComment({}, reply("Great build"))).resolves.toEqual({});
    expect(mocks.allowAction).toHaveBeenCalledWith({ action: "comment" }, "user-1");
    expect(mocks.insert).toHaveBeenCalledOnce();
  });

  it("refuses over the limit without writing (and so without notifying)", async () => {
    mocks.allowAction.mockResolvedValue(false);
    await expect(addComment({}, reply("Great build"))).resolves.toEqual({ error: "slow down" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe("reaction throttling", () => {
  it("limits adding a reaction", async () => {
    mocks.allowAction.mockResolvedValue(false);
    await expect(toggleReaction("post-1", "🔥", "/home", true)).resolves.toEqual({ error: "slow down" });
    expect(mocks.allowAction).toHaveBeenCalledWith({ action: "react" }, "user-1");
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("never limits taking a reaction back", async () => {
    mocks.allowAction.mockResolvedValue(false);
    mocks.existing.mockResolvedValue({ data: { post_id: "post-1" } });
    await expect(toggleReaction("post-1", "🔥", "/home", false)).resolves.toEqual({ reacted: false });
    expect(mocks.allowAction).not.toHaveBeenCalled();
  });
});
