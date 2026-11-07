import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Codex P2 (fourth review of OS-W15): the media job checked its time budget
 * only between cleanup batches of 200 objects. In a Storage outage one
 * object takes tens of seconds, so the first batch ran into the route's
 * 300 s limit and the staged-upload sweep never ran. Both loops now check a
 * deadline before each object, leaving room for calls in flight.
 */

const mocks = vi.hoisted(() => ({
  processMediaCleanupQueue: vi.fn(),
  removeMediaObject: vi.fn(),
  staged: [] as { id: string; owner_id: string; bucket: string; path: string }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/tracked-worker", () => ({ trackedWorker: (_family: string, _request: Request, run: () => Promise<Response>) => run() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn(), flushMonitoring: vi.fn(async () => {}) }));
vi.mock("@/lib/media-lifecycle", () => ({
  ensureMediaStorageOrigin: vi.fn(async () => {}),
  processMediaCleanupQueue: mocks.processMediaCleanupQueue,
  removeMediaObject: mocks.removeMediaObject,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "is", "lt", "order", "limit", "update", "delete", "eq"]) b[m] = () => b;
      b.then = (resolve: (value: unknown) => unknown) => resolve({ data: mocks.staged, error: null });
      return b;
    },
  }),
}));

import { POST } from "./route";

const ME = "11111111-1111-4111-8111-111111111111";
const START = Date.parse("2026-11-07T03:17:00Z");
const request = () => new Request("http://localhost/api/jobs/media-gc", { method: "POST", headers: { authorization: "Bearer secret" } });
const emptyRun = { scanned: 0, removed: 0, retained: 0, rejected: 0, busy: 0, failed: 0, exhausted: 0 };

beforeEach(() => {
  process.env.CRON_SECRET = "secret";
  vi.useFakeTimers({ now: START });
  mocks.processMediaCleanupQueue.mockReset();
  mocks.removeMediaObject.mockReset();
  mocks.staged = [];
});
afterEach(() => vi.useRealTimers());

describe("media-gc time budget", () => {
  it("hands the cleanup queue a deadline it checks before each object, and stops draining when it is reached", async () => {
    mocks.processMediaCleanupQueue.mockResolvedValue({ ...emptyRun, scanned: 7, removed: 7, outOfTime: true });
    const response = await POST(request());
    expect(mocks.processMediaCleanupQueue).toHaveBeenCalledTimes(1);
    expect(mocks.processMediaCleanupQueue.mock.calls[0][0]).toMatchObject({ deadline: START + 120_000 });
    expect((await response.json()).outOfTime).toBe(true);
  });

  it("still reaches the staged sweep, and stops starting objects there before the route's limit", async () => {
    // The queue used its whole slot (120 s) in an outage.
    mocks.processMediaCleanupQueue.mockImplementation(async () => {
      vi.setSystemTime(START + 120_000);
      return { ...emptyRun, scanned: 3, failed: 3, outOfTime: true };
    });
    mocks.staged = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, owner_id: ME, bucket: "car-images", path: `${ME}/${i}.webp` }));
    // Each staged object takes 40 s (two delete timeouts and bookkeeping).
    mocks.removeMediaObject.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 40_000);
      return "removed";
    });
    const response = await POST(request());
    const body = await response.json();
    // Started at 120, 160 and 200 s; at 240 s the 230 s deadline has passed.
    expect(mocks.removeMediaObject).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({ removed: 3, outOfTime: true });
    // Everything finished inside maxDuration (300 s).
    expect(Date.now() - START).toBeLessThanOrEqual(300_000);
  });
});
