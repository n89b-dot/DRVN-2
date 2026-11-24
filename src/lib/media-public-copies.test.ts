import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const { syncPublicPhotoCopies } = await import("./media-public-copies");

const OWNER = "11111111-1111-4111-8111-111111111111";
type Key = { bucket: string; path: string };

/** A stand-in for the service client that records what was asked of it, in order. */
function fakeAdmin(script: {
  retired?: number;
  retireError?: boolean;
  removing?: Key[];
  claimed?: Key[];
  confirm?: Record<string, string>;
  orphans?: Key[];
  copyError?: Record<string, string | { message: string; status?: number; statusCode?: string }>;
  removeError?: Record<string, string>;
}) {
  const calls: string[] = [];
  const admin = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push(`rpc ${fn} ${JSON.stringify(args)}`);
      if (fn === "public_photo_copies_retire") return script.retireError ? { data: null, error: { message: "down" } } : { data: script.retired ?? 0, error: null };
      if (fn === "public_photo_copies_claim") return { data: script.claimed ?? [], error: null };
      if (fn === "public_photo_copy_confirm") return { data: script.confirm?.[`${args.p_bucket}/${args.p_path}`] ?? "live", error: null };
      if (fn === "public_photo_copy_removed") return { data: true, error: null };
      if (fn === "public_photo_copy_unavailable") return { data: null, error: null };
      if (fn === "public_photo_copy_orphans") return { data: script.orphans ?? [], error: null };
      throw new Error(`unexpected rpc ${fn}`);
    }),
    from: (table: string) => {
      const filters: string[] = [];
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit"]) {
        query[method] = (...args: unknown[]) => {
          if (method === "eq") filters.push(`${args[0]}=${args[1]}`);
          return query;
        };
      }
      query.then = (resolve: (value: { data: Key[]; error: null }) => unknown) => {
        calls.push(`read ${table} ${filters.join(",")}`);
        return resolve({ data: script.removing ?? [], error: null });
      };
      return query;
    },
    storage: {
      from: (bucket: string) => ({
        copy: async (from: string, to: string, options: { destinationBucket: string }) => {
          calls.push(`copy ${bucket}/${from} -> ${options.destinationBucket}/${to}`);
          const failure = script.copyError?.[`${bucket}/${from}`];
          if (!failure) return { data: {}, error: null };
          return { data: null, error: typeof failure === "string" ? { message: failure } : failure };
        },
        remove: async (paths: string[]) => {
          calls.push(`remove ${bucket}/${paths[0]}`);
          const message = script.removeError?.[`${bucket}/${paths[0]}`];
          return message ? { data: null, error: { message } } : { data: [], error: null };
        },
      }),
    },
  };
  return { admin: admin as never, calls };
}

beforeEach(() => vi.clearAllMocks());

describe("public copies of published photos (20261124220000)", () => {
  it("retires first, removes what was withdrawn from the public bucket, then copies and confirms, then clears unrecorded objects", async () => {
    const { admin, calls } = fakeAdmin({
      retired: 1,
      removing: [{ bucket: "car-images", path: `${OWNER}/hidden.webp` }],
      claimed: [{ bucket: "listing-images", path: `${OWNER}/part.webp` }],
      orphans: [{ bucket: "car-images", path: `${OWNER}/orphan.webp` }],
    });
    expect(await syncPublicPhotoCopies({ admin })).toEqual({ retired: 1, removed: 1, copied: 1, orphans: 1, unavailable: 0, failed: 0 });
    expect(calls).toEqual([
      "rpc public_photo_copies_retire {}",
      "read public_photo_copies state=removing",
      `remove public-car-images/${OWNER}/hidden.webp`,
      `rpc public_photo_copy_removed {"p_bucket":"car-images","p_path":"${OWNER}/hidden.webp"}`,
      'rpc public_photo_copies_claim {"p_limit":50}',
      // The same path, into the public twin of the member's bucket.
      `copy listing-images/${OWNER}/part.webp -> public-listing-images/${OWNER}/part.webp`,
      `rpc public_photo_copy_confirm {"p_bucket":"listing-images","p_path":"${OWNER}/part.webp"}`,
      'rpc public_photo_copy_orphans {"p_limit":50}',
      `remove public-car-images/${OWNER}/orphan.webp`,
    ]);
  });

  it("for one member, asks only about that member and leaves the unrecorded sweep to the whole-site run", async () => {
    const { admin, calls } = fakeAdmin({});
    await syncPublicPhotoCopies({ admin, ownerId: OWNER, limit: 10 });
    expect(calls).toEqual([
      `rpc public_photo_copies_retire {"p_owner":"${OWNER}"}`,
      `read public_photo_copies state=removing,owner_id=${OWNER}`,
      `rpc public_photo_copies_claim {"p_owner":"${OWNER}","p_limit":10}`,
    ]);
  });

  it("removes a copy it has just written when the photo stopped being shown while it was being made", async () => {
    const hidden = `${OWNER}/hidden-midway.webp`;
    const cleared = `${OWNER}/withdrawn-and-cleared.webp`;
    const { admin, calls } = fakeAdmin({
      claimed: [{ bucket: "car-images", path: hidden }, { bucket: "car-images", path: cleared }],
      confirm: { [`car-images/${hidden}`]: "removing", [`car-images/${cleared}`]: "gone" },
    });
    const result = await syncPublicPhotoCopies({ admin, ownerId: OWNER });
    expect(result).toMatchObject({ copied: 0, failed: 0 });
    expect(calls).toContain(`remove public-car-images/${hidden}`);
    expect(calls).toContain(`rpc public_photo_copy_removed {"p_bucket":"car-images","p_path":"${hidden}"}`);
    // Withdrawn and already cleared: the object goes, and there is no record left to clear.
    expect(calls).toContain(`remove public-car-images/${cleared}`);
    expect(calls.filter((call) => call.includes("public_photo_copy_removed"))).toHaveLength(1);
  });

  it("counts a copy Storage refused and does not confirm it; a copy already there from an earlier attempt is confirmed", async () => {
    const refused = `${OWNER}/refused.webp`;
    const there = `${OWNER}/already-there.webp`;
    const { admin, calls } = fakeAdmin({
      claimed: [{ bucket: "listing-images", path: refused }, { bucket: "listing-images", path: there }],
      copyError: { [`listing-images/${refused}`]: "Internal Server Error", [`listing-images/${there}`]: "The resource already exists" },
    });
    expect(await syncPublicPhotoCopies({ admin, ownerId: OWNER })).toMatchObject({ copied: 1, failed: 1 });
    expect(calls.filter((call) => call.includes("public_photo_copy_confirm"))).toEqual([
      `rpc public_photo_copy_confirm {"p_bucket":"listing-images","p_path":"${there}"}`,
    ]);
  });

  it("records a photo whose bytes are not in storage and moves on: no failure, no confirmation, not tried again", async () => {
    const lost = `${OWNER}/lost.webp`;
    const fine = `${OWNER}/fine.webp`;
    const { admin, calls } = fakeAdmin({
      claimed: [{ bucket: "car-images", path: lost }, { bucket: "car-images", path: fine }],
      copyError: { [`car-images/${lost}`]: "Object not found" },
    });
    expect(await syncPublicPhotoCopies({ admin, ownerId: OWNER })).toMatchObject({ copied: 1, unavailable: 1, failed: 0 });
    expect(calls).toContain(`rpc public_photo_copy_unavailable {"p_bucket":"car-images","p_path":"${lost}"}`);
    expect(calls).not.toContain(`rpc public_photo_copy_confirm {"p_bucket":"car-images","p_path":"${lost}"}`);
  });

  it("reads Storage's status as well as its words: refused for good is recorded, refused for now is tried again", async () => {
    const key = (name: string) => ({ bucket: "listing-images", path: `${OWNER}/${name}.webp` });
    const at = (name: string) => `listing-images/${OWNER}/${name}.webp`;
    const { admin, calls } = fakeAdmin({
      claimed: ["missing", "wrong-type", "busy", "locked-out", "broken", "there"].map(key),
      copyError: {
        // A missing object has come back as a 400 carrying "404" in its body.
        [at("missing")]: { message: "Bad Request", status: 400, statusCode: "404" },
        [at("wrong-type")]: { message: "mime type image/heic is not supported", status: 415 },
        [at("busy")]: { message: "Too Many Requests", status: 429 },
        [at("locked-out")]: { message: "Forbidden", status: 403 },
        [at("broken")]: { message: "Bad Gateway", status: 502 },
        [at("there")]: { message: "Bad Request", status: 400, statusCode: "409" },
      },
    });
    expect(await syncPublicPhotoCopies({ admin, ownerId: OWNER })).toMatchObject({ copied: 1, unavailable: 2, failed: 3 });
    expect(calls.filter((call) => call.includes("public_photo_copy_unavailable"))).toEqual([
      `rpc public_photo_copy_unavailable {"p_bucket":"listing-images","p_path":"${OWNER}/missing.webp"}`,
      `rpc public_photo_copy_unavailable {"p_bucket":"listing-images","p_path":"${OWNER}/wrong-type.webp"}`,
    ]);
    expect(calls.filter((call) => call.includes("public_photo_copy_confirm"))).toEqual([
      `rpc public_photo_copy_confirm {"p_bucket":"listing-images","p_path":"${OWNER}/there.webp"}`,
    ]);
  });

  it("keeps a withdrawn copy's record when Storage could not delete it, so the next run tries again", async () => {
    const stuck = `${OWNER}/stuck.webp`;
    const { admin, calls } = fakeAdmin({
      removing: [{ bucket: "car-images", path: stuck }],
      removeError: { [`public-car-images/${stuck}`]: "Internal Server Error" },
    });
    expect(await syncPublicPhotoCopies({ admin, ownerId: OWNER })).toMatchObject({ removed: 0, failed: 1 });
    expect(calls.some((call) => call.includes("public_photo_copy_removed"))).toBe(false);
  });

  it("stops before touching storage when the copies could not be retired", async () => {
    const { admin, calls } = fakeAdmin({ retireError: true, claimed: [{ bucket: "car-images", path: `${OWNER}/x.webp` }] });
    await expect(syncPublicPhotoCopies({ admin })).rejects.toThrow("could not be retired");
    expect(calls).toEqual(["rpc public_photo_copies_retire {}"]);
  });

  it("stops at its deadline with the retirement done, and says so", async () => {
    const { admin, calls } = fakeAdmin({ retired: 2, removing: [{ bucket: "car-images", path: `${OWNER}/a.webp` }] });
    const result = await syncPublicPhotoCopies({ admin, deadline: Date.now() - 1 });
    expect(result).toMatchObject({ retired: 2, removed: 0, outOfTime: true });
    expect(calls.some((call) => call.startsWith("remove"))).toBe(false);
  });
});
