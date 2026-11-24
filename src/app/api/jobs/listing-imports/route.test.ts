import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn(), flushMonitoring: vi.fn(async () => {}) }));
// The wrapper records a run as failed whenever the response isn't ok; here it
// just runs the sweep.
vi.mock("@/lib/tracked-worker", () => ({
  trackedWorker: (_family: string, _request: Request, run: () => Promise<Response>) => run(),
}));

type Result = { data: unknown; error: unknown };
/** What each database function answers, by name. */
let answers: Record<string, Result> = {};
const rpc = vi.fn(async (name: string) => answers[name] ?? { data: 0, error: null });

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { POST, maxDuration } from "./route";

const call = (authorization = "Bearer cron") =>
  POST(new Request("https://drvn.test/api/jobs/listing-imports", { method: "POST", headers: { authorization } }));

describe("listing-import sweep", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron";
    answers = {};
    rpc.mockClear();
  });

  it("reports what the two statements expired and scrubbed", async () => {
    answers = { expire_stale_listing_imports: { data: 3, error: null }, scrub_expired_listing_imports: { data: 2, error: null } };
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ expired: 3, scrubbed: 2 });
    // One call each: the work is in the database, not a request per row.
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["expire_stale_listing_imports", "scrub_expired_listing_imports"]);
  });

  it("fails the run when the overdue imports can't be expired, rather than reporting an empty sweep", async () => {
    answers = { expire_stale_listing_imports: { data: null, error: { message: "timeout" } } };
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ expired: 0, scrubbed: 0, error: "sweep failed" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails the run when the stale imports can't be scrubbed, and still says what it expired", async () => {
    answers = { expire_stale_listing_imports: { data: 4, error: null }, scrub_expired_listing_imports: { data: null, error: { message: "timeout" } } };
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ expired: 4, scrubbed: 0, error: "sweep failed" });
  });

  it("answers 404 to anyone without the job secret, and reads nothing", async () => {
    expect((await call("Bearer wrong")).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("states its time limit", () => {
    expect(maxDuration).toBe(60);
  });
});
