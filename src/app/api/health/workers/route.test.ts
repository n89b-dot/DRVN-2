import { beforeEach, describe, expect, it, vi } from "vitest";

import { secretDigestHex } from "@/lib/cron-auth";
import { JOB_NAMES, WORKER_FAMILIES } from "@/lib/job-inventory";

const rpc = vi.hoisted(() => vi.fn());
const createAdminClient = vi.hoisted(() => vi.fn(() => ({ rpc })));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { GET } from "./route";

const SECRET = "s".repeat(40);
const call = (authorization?: string) =>
  GET(new Request("https://drvn.test/api/health/workers", { headers: authorization ? { authorization } : {} }));
const snapshot = (overrides: { secret?: string; staleJob?: string } = {}) => ({
  families: WORKER_FAMILIES.map((family) => ({ family, stale: false })),
  jobs: JOB_NAMES.map((job) => ({ job, stale: job === overrides.staleJob, reason: job === overrides.staleJob ? "not_scheduled" : null })),
  queues: [],
  config: {
    scheduler: true,
    run_history: true,
    pg_net: true,
    worker_url: "https://drvn.example/api/jobs/transfers",
    worker_secret_sha256: secretDigestHex(overrides.secret ?? SECRET),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  process.env.TYPESENSE_URL = "https://search.example";
  process.env.TYPESENSE_API_KEY = "key";
  process.env.POSTHOG_KEY = "ph";
});

describe("GET /api/health/workers", () => {
  it.each([undefined, `Bearer ${SECRET.slice(1)}`, `Bearer ${SECRET}x`, `Bearer ${"t".repeat(40)}`, "Bearer "])(
    "is a 404 to %s, and reads nothing",
    async (authorization) => {
      const response = await call(authorization);
      expect(response.status).toBe(404);
      expect(createAdminClient).not.toHaveBeenCalled();
    },
  );

  it("is a 404 to everyone when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer ")).status).toBe(404);
    expect((await call("Bearer undefined")).status).toBe(404);
  });

  it("is 200 with no problems when every job and family ran", async () => {
    rpc.mockResolvedValue({ data: snapshot(), error: null });
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.healthy).toBe(true);
    expect(body.problems).toEqual([]);
    expect(body.jobs).toHaveLength(JOB_NAMES.length);
  });

  it("is 503 naming the job that stopped", async () => {
    rpc.mockResolvedValue({ data: snapshot({ staleJob: "drvn-media-gc" }), error: null });
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.healthy).toBe(false);
    expect(body.problems).toEqual([{ area: "job", name: "drvn-media-gc", reason: "not_scheduled", since: null }]);
  });

  it("reports a scheduler holding a different secret, without returning either", async () => {
    rpc.mockResolvedValue({ data: snapshot({ secret: "an old secret, rotated in the app only" }), error: null });
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text).problems).toEqual([{ area: "config", name: "workerSecret", reason: "mismatch" }]);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(secretDigestHex("an old secret, rotated in the app only"));
    expect(text).not.toContain("drvn.example");
  });

  it("is 503 when the snapshot can't be read or is incomplete", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
    rpc.mockResolvedValue({ data: { ...snapshot(), jobs: [] }, error: null });
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Health data incomplete" });
  });
});
