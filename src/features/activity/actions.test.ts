import fs from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowAction: vi.fn(),
  insert: vi.fn(),
  existing: vi.fn(),
  post: vi.fn(),
  deleted: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/suspension", () => ({ SUSPENDED_MESSAGE: "suspended", isSuspended: vi.fn(async () => false) }));
vi.mock("@/lib/rate-limit", () => ({
  allowAction: mocks.allowAction,
  rateLimitMessage: () => "slow down",
  RATE_LIMITS: { addComment: { action: "comment" }, react: { action: "react" } },
}));
vi.mock("@/lib/supabase/server", () => {
  // Every filter returns the same chain; the terminal calls are what matter.
  function chainFor(table: string) {
    const chain: Record<string, unknown> = {};
    let deleting = false;
    for (const name of ["eq", "not", "is"]) chain[name] = () => chain;
    chain.select = () => (deleting && table === "activity_comments" ? mocks.deleted() : chain);
    chain.delete = () => {
      deleting = true;
      return chain;
    };
    chain.maybeSingle = () => (table === "activity_posts" ? mocks.post() : mocks.existing());
    chain.insert = (row: unknown) => mocks.insert(row);
    chain.then = (resolve: (value: unknown) => void) => resolve({ error: null });
    return chain;
  }
  return {
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => chainFor(table),
    }),
  };
});

const { addComment, deleteComment, toggleReaction } = await import("./actions");
const { postPagePaths } = await import("./post-paths");

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
  mocks.post.mockResolvedValue({ data: { id: "post-1", cars: { slug: "my-e30" } } });
  mocks.deleted.mockResolvedValue({ data: [{ id: "reply-1", post_id: "post-1" }], error: null });
});

function revalidatedPaths(): string[] {
  return mocks.revalidatePath.mock.calls.map(([path]) => path as string);
}

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
    await expect(toggleReaction("post-1", "🔥", true)).resolves.toEqual({ error: "slow down" });
    expect(mocks.allowAction).toHaveBeenCalledWith({ action: "react" }, "user-1");
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("never limits taking a reaction back", async () => {
    mocks.allowAction.mockResolvedValue(false);
    mocks.existing.mockResolvedValue({ data: { post_id: "post-1" } });
    await expect(toggleReaction("post-1", "🔥", false)).resolves.toEqual({ reacted: false });
    expect(mocks.allowAction).not.toHaveBeenCalled();
  });
});

describe("what reactions and replies refresh (N58)", () => {
  it("is the post's own pages, worked out on the server", () => {
    expect(postPagePaths({ id: "post-1", carSlug: "my-e30" })).toEqual(["/cars/my-e30/activity/post-1", "/cars/my-e30"]);
    expect(postPagePaths({ id: "post-2", carSlug: null })).toEqual(["/posts/post-2"]);
  });

  it("ignores a path the browser sends with a reply", async () => {
    const form = reply("Great build");
    form.set("path", "/");
    await expect(addComment({}, form)).resolves.toEqual({});
    expect(revalidatedPaths()).toEqual(["/cars/my-e30/activity/post-1", "/cars/my-e30"]);
    // `/` would have cleared every kind of public data; a car post clears
    // only what a car page shows.
    const tags = mocks.revalidateTag.mock.calls.map(([tag]) => tag);
    expect(tags).not.toContain("public:listings");
    expect(tags).not.toContain("public:profiles");
  });

  it("ignores an extra path argument on a reaction, as an old client sends", async () => {
    const legacy = toggleReaction as unknown as (...args: unknown[]) => Promise<unknown>;
    await expect(legacy("post-1", "🔥", "/admin", true)).resolves.toEqual({ reacted: true });
    expect(revalidatedPaths()).toEqual(["/cars/my-e30/activity/post-1", "/cars/my-e30"]);
  });

  it("refreshes a post without a car at its own address", async () => {
    mocks.post.mockResolvedValue({ data: { id: "post-1", cars: null } });
    await expect(toggleReaction("post-1", "🔥", true)).resolves.toEqual({ reacted: true });
    expect(revalidatedPaths()).toEqual(["/posts/post-1"]);
  });

  it("refreshes nothing for a post the member can't read", async () => {
    mocks.post.mockResolvedValue({ data: null });
    await expect(toggleReaction("post-1", "🔥", true)).resolves.toEqual({ reacted: true });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("finds a deleted reply's post from the row it deleted, not from the browser", async () => {
    const legacy = deleteComment as unknown as (...args: unknown[]) => Promise<unknown>;
    await expect(legacy("reply-1", "/")).resolves.toEqual({ ok: true });
    expect(revalidatedPaths()).toEqual(["/cars/my-e30/activity/post-1", "/cars/my-e30"]);
  });

  it("takes no path from its callers", () => {
    const source = fs.readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/formData\.get\("path"\)/);
    expect(source).not.toMatch(/revalidatePath\(/);
  });
});
