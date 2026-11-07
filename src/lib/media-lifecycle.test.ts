import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

const state = vi.hoisted(() => ({
  referenced: false as boolean | null,
  rpcError: null as unknown,
  queue: [] as { bucket: string; path: string; owner_id: string; attempts: number }[],
}));
const remove = vi.fn<(paths: string[]) => Promise<{ error: unknown }>>(async () => ({ error: null }));
const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: boolean | null; error: unknown }>>(
  async () => ({ data: state.referenced, error: state.rpcError })
);
const writes: { table: string; op: string; filters: [string, unknown][]; values?: unknown }[] = [];

function builder(table: string) {
  const entry: { table: string; op: string; filters: [string, unknown][]; values?: unknown } = { table, op: "select", filters: [] };
  const b: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "lt", "is"]) b[method] = () => b;
  b.eq = (column: string, value: unknown) => { entry.filters.push([column, value]); return b; };
  b.in = (column: string, value: unknown) => { entry.filters.push([column, value]); return b; };
  b.delete = () => { entry.op = "delete"; writes.push(entry); return b; };
  b.update = (values: unknown) => { entry.op = "update"; entry.values = values; writes.push(entry); return b; };
  b.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: table === "media_cleanup_queue" && entry.op === "select" ? state.queue : [], error: null });
  return b;
}
const admin = { from: (table: string) => builder(table), rpc, storage: { from: () => ({ remove }) } };
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";

import { deleteMediaIfUnreferenced, finalizeMediaUrls, ownedDeletionTarget, processMediaCleanupQueue, removeMediaObject } from "./media-lifecycle";

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const url = (owner: string, bucket = "listing-images", file = "photo.webp") =>
  `https://example.supabase.co/storage/v1/object/public/${bucket}/${owner}/${file}`;

beforeEach(() => {
  remove.mockClear();
  rpc.mockClear();
  writes.length = 0;
  state.referenced = false;
  state.rpcError = null;
  state.queue = [];
});

describe("deleteMediaIfUnreferenced", () => {
  it("removes the caller's own unreferenced object", async () => {
    expect(await deleteMediaIfUnreferenced(url(ME), false, ME)).toBe("removed");
    expect(remove).toHaveBeenCalledWith([`${ME}/photo.webp`]);
  });

  it("never removes another member's object on a member's behalf", async () => {
    expect(await deleteMediaIfUnreferenced(url(THEM), false, ME)).toBe("skipped");
    expect(rpc).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("has no owner-less mode: every removal names the owner it must belong to", async () => {
    expect(await deleteMediaIfUnreferenced(url(ME), false, "")).toBe("skipped");
    expect(await deleteMediaIfUnreferenced(url(ME), false, "not-a-uuid")).toBe("skipped");
    expect(remove).not.toHaveBeenCalled();
  });

  /**
   * N99: an encoded or variant spelling used to slip past the in-use check
   * (which compared the URL as typed) while still deleting the real object.
   * Now every spelling asks the database about the same canonical object.
   */
  it.each([
    ["an encoded letter", url(ME).replace("photo.webp", "%70hoto.webp")],
    ["an encoded dot", url(ME).replace("photo.webp", "photo%2Ewebp")],
    ["a query string", `${url(ME)}?download=1`],
    ["a fragment", `${url(ME)}#x`],
    ["the signed route", `${url(ME).replace("/object/public/", "/object/sign/")}?token=t`],
  ])("checks references for the canonical object behind %s", async (_label, target) => {
    state.referenced = true;
    expect(await deleteMediaIfUnreferenced(target, false, ME)).toBe("referenced");
    expect(rpc).toHaveBeenCalledWith("media_object_referenced", { p_bucket: "listing-images", p_path: `${ME}/photo.webp` });
    expect(remove).not.toHaveBeenCalled();
  });

  it("refuses paths that could climb out of the owner's folder", async () => {
    for (const target of [
      url(ME).replace("/photo.webp", "/%2E%2E/photo.webp"),
      `https://example.supabase.co/storage/v1/object/public/listing-images/${ME}/../${THEM}/photo.webp`,
      url(ME).replace("photo.webp", "ph%zzoto.webp"),
    ]) {
      expect(await deleteMediaIfUnreferenced(target, false, ME), target).toBe("skipped");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses objects on a host we don't own", async () => {
    expect(await deleteMediaIfUnreferenced(url(ME).replace("example.supabase.co", "evil.example"), false, ME)).toBe("skipped");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the object when the reference check can't answer", async () => {
    state.rpcError = { message: "timeout" };
    expect(await deleteMediaIfUnreferenced(url(ME), false, ME)).toBe("skipped");
    expect(remove).not.toHaveBeenCalled();
    await expect(deleteMediaIfUnreferenced(url(ME), true, ME)).rejects.toThrow(/reference lookup failed/);
  });

  it("clears the staging row by object, not by URL spelling", async () => {
    await deleteMediaIfUnreferenced(`${url(ME)}?x=1`, false, ME);
    expect(writes).toContainEqual(expect.objectContaining({ table: "staged_uploads", op: "delete", filters: [["bucket", "listing-images"], ["path", `${ME}/photo.webp`]] }));
  });
});

describe("removeMediaObject — the GC's owner check (N12)", () => {
  it("treats an object outside the verified owner's folder as invalid, never touching storage", async () => {
    // B5: the other party's staged row named the buyer's evidence.
    expect(await removeMediaObject({ bucket: "dispute-evidence", path: `${THEM}/order/e.jpg` }, ME)).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps attached evidence: the database answers 'referenced' by storage path", async () => {
    state.referenced = true;
    expect(await removeMediaObject({ bucket: "dispute-evidence", path: `${ME}/order/e.jpg` }, ME)).toBe("referenced");
    expect(rpc).toHaveBeenCalledWith("media_object_referenced", { p_bucket: "dispute-evidence", p_path: `${ME}/order/e.jpg` });
  });

  it("only acts on buckets members upload to", () => {
    expect(ownedDeletionTarget({ bucket: "account-exports", path: `${ME}/x.zip` }, ME)).toBeNull();
    expect(ownedDeletionTarget({ bucket: "car-images", path: `${ME}/x.webp` }, ME)).toEqual({ bucket: "car-images", path: `${ME}/x.webp` });
  });
});

describe("finalizeMediaUrls", () => {
  it("stamps staged rows by canonical object path, whatever the URL spelling", async () => {
    const client = admin as unknown as Parameters<typeof finalizeMediaUrls>[0];
    await finalizeMediaUrls(client, [url(ME), `${url(ME, "car-images", "b.webp")}?x`, "https://evil.example/nothing"]);
    expect(writes).toContainEqual(
      expect.objectContaining({ table: "staged_uploads", op: "update", filters: [["path", [`${ME}/photo.webp`, `${ME}/b.webp`]]] })
    );
  });
});

describe("processMediaCleanupQueue (N51)", () => {
  it("removes unreferenced photos of deleted content, keeps referenced ones, and dequeues both", async () => {
    state.queue = [
      { bucket: "car-images", path: `${ME}/car/gone.webp`, owner_id: ME, attempts: 0 },
      { bucket: "listing-images", path: `${ME}/sold.webp`, owner_id: ME, attempts: 0 },
    ];
    rpc.mockImplementation(async (_name, args) => ({ data: args.p_path === `${ME}/sold.webp`, error: null }));
    const run = await processMediaCleanupQueue();
    expect(run).toEqual({ scanned: 2, removed: 1, retained: 1, rejected: 0, failed: 0 });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([`${ME}/car/gone.webp`]);
    expect(writes.filter((w) => w.table === "media_cleanup_queue" && w.op === "delete")).toHaveLength(2);
    rpc.mockImplementation(async () => ({ data: state.referenced, error: state.rpcError }));
  });

  it("retries a transient failure later instead of dropping it", async () => {
    state.queue = [{ bucket: "car-images", path: `${ME}/car/x.webp`, owner_id: ME, attempts: 2 }];
    state.rpcError = { message: "timeout" };
    const run = await processMediaCleanupQueue();
    expect(run.failed).toBe(1);
    expect(writes).toContainEqual(expect.objectContaining({ table: "media_cleanup_queue", op: "update", values: expect.objectContaining({ attempts: 3 }) }));
    expect(writes.some((w) => w.table === "media_cleanup_queue" && w.op === "delete")).toBe(false);
  });

  it("never removes a queued object that isn't in its owner's folder", async () => {
    state.queue = [{ bucket: "car-images", path: `${THEM}/car/x.webp`, owner_id: ME, attempts: 0 }];
    const run = await processMediaCleanupQueue();
    expect(run.rejected).toBe(1);
    expect(remove).not.toHaveBeenCalled();
  });
});
