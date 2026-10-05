import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

const remove = vi.fn(async () => ({ error: null }));
const admin = {
  from: () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "delete", "limit", "or", "contains", "in"]) builder[method] = () => builder;
    builder.then = (resolve: (value: unknown) => unknown) => resolve({ count: 0, data: [], error: null });
    return builder;
  },
  rpc: async () => ({ data: false, error: null }),
  storage: { from: () => ({ remove }) },
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";

import { deleteMediaIfUnreferenced } from "./media-lifecycle";

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const url = (owner: string, bucket = "listing-images") =>
  `https://example.supabase.co/storage/v1/object/public/${bucket}/${owner}/photo.webp`;

describe("deleteMediaIfUnreferenced", () => {
  beforeEach(() => remove.mockClear());

  it("removes the caller's own unreferenced object", async () => {
    expect(await deleteMediaIfUnreferenced(url(ME), false, ME)).toBe("removed");
    expect(remove).toHaveBeenCalledWith([`${ME}/photo.webp`]);
  });

  it("never removes another member's object on a member's behalf", async () => {
    expect(await deleteMediaIfUnreferenced(url(THEM), false, ME)).toBe("skipped");
    expect(remove).not.toHaveBeenCalled();
  });

  it("refuses a URL dressed up to dodge the reference check", async () => {
    expect(await deleteMediaIfUnreferenced(`${url(ME)}?x`, false, ME)).toBe("skipped");
    expect(await deleteMediaIfUnreferenced(`${url(THEM)}#x`)).toBe("skipped");
    expect(remove).not.toHaveBeenCalled();
  });

  it("still lets the server's own jobs remove any member's unreferenced object", async () => {
    expect(await deleteMediaIfUnreferenced(url(THEM))).toBe("removed");
  });
});
