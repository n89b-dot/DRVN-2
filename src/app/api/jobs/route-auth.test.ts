import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every scheduled job route and protected health endpoint shares one door:
 * a constant-time bearer check (src/lib/cron-auth.ts). Wrong, shorter, longer
 * or empty bearers get a 404 before anything is read or recorded.
 */

const createAdminClient = vi.hoisted(() => vi.fn(() => { throw new Error("no database access before authorization"); }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn(), flushMonitoring: vi.fn(async () => {}), captureException: vi.fn(), captureMessage: vi.fn() }));

const API = resolve(__dirname, "..");
const SECRET = "j".repeat(48);

const jobRoutes = readdirSync(__dirname, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe("every protected route uses the shared constant-time door", () => {
  it("finds the job routes", () => {
    expect(jobRoutes).toEqual(expect.arrayContaining(["agent", "account-deletions", "listing-imports", "media-gc", "saved-searches", "search", "transfers"]));
  });

  it.each([...jobRoutes.map((name) => join(__dirname, name, "route.ts")), join(API, "health", "workers", "route.ts")])(
    "%s compares no secret by hand",
    (file) => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/[!=]==?\s*`Bearer/);
      expect(source).not.toMatch(/CRON_SECRET\s*[!=]==?/);
      expect(/cronAuthorized\(request\)|trackedWorker\(/.test(source)).toBe(true);
    },
  );

  it("the tracked-worker wrapper uses it too", () => {
    const source = readFileSync(resolve(__dirname, "..", "..", "..", "lib", "tracked-worker.ts"), "utf8");
    expect(source).toContain("cronAuthorized(request)");
    expect(source).not.toMatch(/[!=]==?\s*`Bearer/);
  });
});

describe("a wrong bearer gets a 404 and touches nothing", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    createAdminClient.mockClear();
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  const bearers: [string, string | undefined][] = [
    ["no header", undefined],
    ["an empty bearer", "Bearer "],
    ["a same-length wrong secret", `Bearer ${"k".repeat(48)}`],
    ["a shorter secret", `Bearer ${SECRET.slice(0, 47)}`],
    ["a longer secret", `Bearer ${SECRET}j`],
  ];

  it.each(jobRoutes)("/api/jobs/%s", async (name) => {
    const { POST } = (await import(`./${name}/route.ts`)) as { POST: (request: Request) => Promise<Response> };
    for (const [label, authorization] of bearers) {
      const response = await POST(new Request(`https://drvn.test/api/jobs/${name}`, { method: "POST", headers: authorization === undefined ? {} : { authorization } }));
      expect(response.status, label).toBe(404);
    }
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each(jobRoutes)("/api/jobs/%s refuses everyone without CRON_SECRET", async (name) => {
    delete process.env.CRON_SECRET;
    const { POST } = (await import(`./${name}/route.ts`)) as { POST: (request: Request) => Promise<Response> };
    const response = await POST(new Request(`https://drvn.test/api/jobs/${name}`, { method: "POST", headers: { authorization: "Bearer undefined" } }));
    expect(response.status).toBe(404);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
