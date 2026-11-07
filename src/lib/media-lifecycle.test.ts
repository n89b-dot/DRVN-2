import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

const state = vi.hoisted(() => ({
  referenced: false as boolean | null,
  rpcError: null as unknown,
  queue: [] as { bucket: string; path: string; owner_id: string; attempts: number }[],
}));
const remove = vi.fn<(paths: string[]) => Promise<{ error: unknown }>>(async () => ({ error: null }));
// claim_media_deletion answers {status: "claimed", token} when nothing
// references the object, {status: "referenced"} when something does.
type RpcResult = { data: unknown; error: unknown };
const claimed = (referenced: boolean) => (referenced ? { status: "referenced" } : { status: "claimed", token: "token-1" });
const defaultRpc = async (name: string): Promise<RpcResult> => {
  if (name === "claim_media_deletion") return { data: state.rpcError ? null : claimed(Boolean(state.referenced)), error: state.rpcError };
  if (name === "complete_media_deletion" || name === "release_media_claim") return { data: true, error: null };
  return { data: null, error: null };
};
const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<RpcResult>>(defaultRpc);
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
  remove.mockReset();
  remove.mockImplementation(async () => ({ error: null }));
  rpc.mockReset();
  rpc.mockImplementation(defaultRpc);
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
    expect(rpc).toHaveBeenCalledWith("claim_media_deletion", { p_bucket: "listing-images", p_path: `${ME}/photo.webp` });
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

describe("removeMediaObject — claim before delete (N12 race)", () => {
  it("claims the object in the database before touching storage", async () => {
    expect(await removeMediaObject(url(ME), ME)).toBe("removed");
    expect(rpc.mock.calls[0]).toEqual(["claim_media_deletion", { p_bucket: "listing-images", p_path: `${ME}/photo.webp` }]);
    expect(remove.mock.invocationCallOrder[0]).toBeGreaterThan(rpc.mock.invocationCallOrder[0]);
  });

  it("never deletes an object the claim found referenced, e.g. evidence attached meanwhile", async () => {
    state.referenced = true;
    expect(await removeMediaObject({ bucket: "dispute-evidence", path: `${ME}/order/e.jpg` }, ME)).toBe("referenced");
    expect(remove).not.toHaveBeenCalled();
  });

  it("releases only its own claim when the storage delete fails, and completes it when it succeeds", async () => {
    remove.mockResolvedValueOnce({ error: { message: "storage down" } });
    expect(await removeMediaObject(url(ME), ME)).toBe("failed");
    expect(rpc).toHaveBeenCalledWith("release_media_claim", { p_bucket: "listing-images", p_path: `${ME}/photo.webp`, p_token: "token-1" });
    rpc.mockClear();
    expect(await removeMediaObject(url(ME), ME)).toBe("removed");
    expect(rpc).toHaveBeenCalledWith("complete_media_deletion", { p_bucket: "listing-images", p_path: `${ME}/photo.webp`, p_token: "token-1" });
  });
});

/**
 * Codex P1 (second review): two removers of one object — the after-delete
 * run and the daily job — used to share one claim, so one's failed delete
 * released the claim while the other's delete was still in flight, evidence
 * then attached, and the late delete took it. Here the database half is a
 * faithful in-memory model of claim_media_deletion / complete / release
 * (one active claim, token-gated), and the Storage deletes are held open so
 * the interleaving is fixed, not timed.
 */
describe("two removers of one object (claim tokens)", () => {
  type Claim = { token: string; state: "active" | "done" };
  let claims: Map<string, Claim>;
  let references: Set<string>;
  let next: number;
  const key = (args: Record<string, unknown>) => `${args.p_bucket}/${args.p_path}`;

  beforeEach(() => {
    claims = new Map();
    references = new Set();
    next = 0;
    rpc.mockImplementation(async (name, args) => {
      const k = key(args);
      const existing = claims.get(k);
      if (name === "claim_media_deletion") {
        if (existing?.state === "done") return { data: { status: "gone" }, error: null };
        if (existing) return { data: { status: "busy" }, error: null };
        if (references.has(k)) return { data: { status: "referenced" }, error: null };
        const token = `t${++next}`;
        claims.set(k, { token, state: "active" });
        return { data: { status: "claimed", token }, error: null };
      }
      const held = existing?.state === "active" && existing.token === args.p_token;
      if (name === "release_media_claim") {
        if (held) claims.delete(k);
        return { data: held, error: null };
      }
      if (name === "complete_media_deletion") {
        if (held) existing!.state = "done";
        return { data: held, error: null };
      }
      return { data: null, error: null };
    });
  });

  /** A held-open Storage delete the test settles when it chooses. */
  function deferredRemove() {
    let settle!: (result: { error: unknown }) => void;
    const pending = new Promise<{ error: unknown }>((resolve) => (settle = resolve));
    remove.mockImplementationOnce(() => pending);
    return settle;
  }

  it("a second remover never deletes while the first holds the claim; the first's failure frees it for a reference", async () => {
    const evidence = { bucket: "dispute-evidence", path: `${ME}/order/e.jpg` };
    const failA = deferredRemove();
    const a = removeMediaObject(evidence, ME); // claims (t1), delete in flight
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    // B arrives mid-delete: busy, and it calls no Storage delete at all.
    expect(await removeMediaObject(evidence, ME)).toBe("busy");
    expect(remove).toHaveBeenCalledTimes(1);
    // A's delete fails; it releases its own claim (t1) and only that.
    failA({ error: { message: "storage down" } });
    expect(await a).toBe("failed");
    expect(claims.has(`${evidence.bucket}/${evidence.path}`)).toBe(false);
    // The evidence is attached, then B retries late: it finds the reference.
    references.add(`${evidence.bucket}/${evidence.path}`);
    expect(await removeMediaObject(evidence, ME)).toBe("referenced");
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("a late success by the holder completes its claim; a second remover then finds the object gone", async () => {
    const photo = { bucket: "car-images", path: `${ME}/car/x.webp` };
    const finishA = deferredRemove();
    const a = removeMediaObject(photo, ME);
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(await removeMediaObject(photo, ME)).toBe("busy");
    // A stale token can neither complete nor release the live claim.
    expect((await rpc("release_media_claim", { ...{ p_bucket: photo.bucket, p_path: photo.path }, p_token: "t-stale" })).data).toBe(false);
    finishA({ error: null });
    expect(await a).toBe("removed");
    expect(claims.get(`${photo.bucket}/${photo.path}`)).toEqual({ token: "t1", state: "done" });
    expect(await removeMediaObject(photo, ME)).toBe("removed");
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("a busy object stays queued without spending an attempt", async () => {
    claims.set(`car-images/${ME}/car/q.webp`, { token: "other", state: "active" });
    state.queue = [{ bucket: "car-images", path: `${ME}/car/q.webp`, owner_id: ME, attempts: 0 }];
    const run = await processMediaCleanupQueue();
    expect(run).toMatchObject({ busy: 1, failed: 0 });
    expect(remove).not.toHaveBeenCalled();
    expect(writes.some((w) => w.table === "media_cleanup_queue")).toBe(false);
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
    expect(rpc).toHaveBeenCalledWith("claim_media_deletion", { p_bucket: "dispute-evidence", p_path: `${ME}/order/e.jpg` });
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
    rpc.mockImplementation(async (name, args) =>
      name === "claim_media_deletion" ? { data: claimed(args.p_path === `${ME}/sold.webp`), error: null } : defaultRpc(name)
    );
    const run = await processMediaCleanupQueue();
    expect(run).toEqual({ scanned: 2, removed: 1, retained: 1, rejected: 0, busy: 0, failed: 0 });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([`${ME}/car/gone.webp`]);
    expect(writes.filter((w) => w.table === "media_cleanup_queue" && w.op === "delete")).toHaveLength(2);
    rpc.mockImplementation(defaultRpc);
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
