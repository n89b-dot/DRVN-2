import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn(), flushMonitoring: vi.fn(async () => {}) }));
// The wrapper records a run as failed whenever the response isn't ok; here it
// just runs the sweep.
vi.mock("@/lib/tracked-worker", () => ({
  trackedWorker: (_family: string, _request: Request, run: () => Promise<Response>) => run(),
}));

type Result = { data: unknown; error: unknown };
let reads: Result[] = [];
let updateError: unknown = null;
const updates = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from() {
      let updating = false;
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "not", "lt", "order", "limit", "in", "eq"]) builder[method] = () => builder;
      builder.update = (values: unknown) => {
        updating = true;
        updates(values);
        return builder;
      };
      builder.then = (resolve: (value: Result) => unknown) =>
        resolve(updating ? { data: null, error: updateError } : (reads.shift() ?? { data: [], error: null }));
      return builder;
    },
  }),
}));

import { POST } from "./route";

const call = () =>
  POST(new Request("https://drvn.test/api/jobs/listing-imports", { method: "POST", headers: { authorization: "Bearer cron" } }));

describe("listing-import sweep", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron";
    reads = [];
    updateError = null;
    updates.mockClear();
  });

  it("reports what it expired and scrubbed", async () => {
    reads = [
      { data: [{ id: "a", status: "ready" }], error: null },
      { data: [{ id: "b" }], error: null },
    ];
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ expired: 1, scrubbed: 1 });
  });

  it("fails the run when the overdue imports can't be read, rather than reporting an empty sweep", async () => {
    reads = [{ data: null, error: { message: "timeout" } }];
    const response = await call();
    expect(response.status).toBe(500);
    expect(updates).not.toHaveBeenCalled();
  });

  it("fails the run when the stale imports can't be read", async () => {
    reads = [
      { data: [], error: null },
      { data: null, error: { message: "timeout" } },
    ];
    expect((await call()).status).toBe(500);
  });

  it("fails the run when a row could not be scrubbed", async () => {
    reads = [
      { data: [], error: null },
      { data: [{ id: "b" }], error: null },
    ];
    updateError = { message: "refused" };
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ scrubbed: 0, failed: 1 });
  });

  it("works through more than one batch in a run", async () => {
    const batch = Array.from({ length: 200 }, (_, index) => ({ id: `row-${index}`, status: "ready" }));
    reads = [
      { data: batch, error: null },
      { data: [{ id: "last", status: "ready" }], error: null },
      { data: [], error: null },
    ];
    expect(await (await call()).json()).toEqual({ expired: 201, scrubbed: 0 });
  });
});
