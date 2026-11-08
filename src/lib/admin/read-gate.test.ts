import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N11 (launch blocker B4): the console read with the all-access key while
 * checking access only in the layout, which a hand-made RSC or route request
 * never runs. Now the gate is inside every privileged read. These tests call
 * the read layer, console pages and the export route DIRECTLY — no layout —
 * as someone who isn't a current, stepped-up admin, and require a 404 (or the
 * step-up redirect) before the all-access client even exists.
 */

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  role: null as string | null,
  aal: "aal2",
  totpAt: 0,
  serviceClients: 0,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    state.serviceClients += 1;
    throw new Error("the all-access client was created for an unauthorised read");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: state.aal, currentAuthenticationMethods: [{ method: "totp", timestamp: state.totpAt }] },
          error: null,
        }),
      },
    },
    rpc: async (name: string) => ({ data: name === "admin_role" ? state.role : name === "is_admin" ? state.role !== null : null, error: null }),
  }),
}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/evidence-urls", () => ({ signEvidenceUrls: vi.fn() }));
// The pages' mutation imports aren't under test here.
vi.mock("@/lib/admin/actions", () => Object.fromEntries(
  ["adminForceRefund", "adminResolveForSeller", "adminRemoveListing", "adminRestoreListing", "adminSuspendUser", "adminUnsuspendUser", "adminResolveReport", "adminResolveIdentityReview", "adminRemoveReportedContent", "adminRunTransferWorker", "adminReplaceFailedRefund", "adminResolveRecovery", "adminRetryCarryPayout", "adminCancelCarryPayout", "adminAddNote", "adminReconcileOperation", "adminMessageParties", "adminResolveReports", "adminReplayWebhookEvent", "adminSendTestAlert", "adminCaseClaim", "adminCaseUpdate"].map((name) => [name, vi.fn()])
));
vi.mock("next/link", () => ({ default: () => null }));

const queries = await import("./queries");
const identity = await import("./product-identity");

const now = () => Math.floor(Date.now() / 1000);

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "allowed";
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? (error as Error).message);
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return "404";
    if (digest.startsWith("NEXT_REDIRECT")) return "redirect";
    return `error: ${digest}`;
  }
}

const ID = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

/** Every exported read, with arguments it would get from a page. */
const reads: [string, () => Promise<unknown>][] = [
  ["getOverview", () => queries.getOverview()],
  ["getDisputeQueue", () => queries.getDisputeQueue("open", {})],
  ["getOrderDetail", () => queries.getOrderDetail(ID)],
  ["searchOrders", () => queries.searchOrders({})],
  ["getOrderStatusCounts", () => queries.getOrderStatusCounts({ statuses: ["paid"] })],
  ["searchListings", () => queries.searchListings({})],
  ["searchUsers", () => queries.searchUsers("", "sellers")],
  ["getUserDetail", () => queries.getUserDetail(ID)],
  ["getReports", () => queries.getReports("open")],
  ["getPaymentsOps", () => queries.getPaymentsOps()],
  ["getAuditLog", () => queries.getAuditLog()],
  ["exportAuditRows", () => queries.exportAuditRows({})],
  ["exportOrderRows", () => queries.exportOrderRows("orders", {})],
  ["getNavCounts", () => queries.getNavCounts()],
  ["getAdminIdentity", () => queries.getAdminIdentity(ID)],
  ["getAdminRoster", () => queries.getAdminRoster()],
  ["getWorkerJobs", () => queries.getWorkerJobs()],
  ["listOpsCases", () => queries.listOpsCases()],
  ["getOpenOperations", () => queries.getOpenOperations()],
  ["getProductCoverage", () => identity.getProductCoverage()],
  ["getIdentityReviews", () => identity.getIdentityReviews("open")],
  ["countOpenIdentityReviews", () => identity.countOpenIdentityReviews()],
];

beforeEach(() => {
  Object.assign(state, { user: null, role: null, aal: "aal2", totpAt: now() - 60, serviceClients: 0 });
});

describe("every privileged read checks for itself", () => {
  it("covers every exported read in the read layer", () => {
    const exported = [
      ...Object.entries(queries).filter(([name, value]) => typeof value === "function" && name !== "uuidPrefixRange" && name !== "ExportTooLargeError"),
      ...Object.entries(identity).filter(([, value]) => typeof value === "function"),
    ].map(([name]) => name);
    expect(exported.sort()).toEqual(reads.map(([name]) => name).sort());
  });

  it.each(reads)("%s 404s a signed-out request before any all-access read", async (_name, read) => {
    await expect(outcome(read)).resolves.toBe("404");
    expect(state.serviceClients).toBe(0);
  });

  it.each(reads)("%s 404s a member removed from the console", async (_name, read) => {
    state.user = { id: "former-admin" };
    state.role = null;
    await expect(outcome(read)).resolves.toBe("404");
    expect(state.serviceClients).toBe(0);
  });

  it.each(reads)("%s sends a lapsed (16-minute-old) step-up to verify before any read", async (_name, read) => {
    state.user = { id: "admin-1" };
    state.role = "admin";
    state.totpAt = now() - 16 * 60;
    await expect(outcome(read)).resolves.toBe("redirect");
    expect(state.serviceClients).toBe(0);
  });

  it("lets a current admin through to the all-access client", async () => {
    state.user = { id: "admin-1" };
    state.role = "admin";
    await expect(outcome(() => queries.getOverview())).resolves.toMatch(/all-access client was created/);
    expect(state.serviceClients).toBe(1);
  });
});

describe("console pages and the export route, requested directly (no layout)", () => {
  const pages: [string, () => Promise<unknown>][] = [
    ["/admin/audit", async () => (await import("@/app/(admin)/admin/audit/page")).default({ searchParams: Promise.resolve({}) })],
    ["/admin/users/[id]", async () => (await import("@/app/(admin)/admin/users/[id]/page")).default({ params: Promise.resolve({ id: ID }) } as never)],
    ["/admin/orders/[id]", async () => (await import("@/app/(admin)/admin/orders/[id]/page")).default({ params: Promise.resolve({ id: ID }) })],
    ["/admin/agent", async () => (await import("@/app/(admin)/admin/agent/page")).default()],
    ["/admin/agent/members/[id]", async () => (await import("@/app/(admin)/admin/agent/members/[id]/page")).default({ params: Promise.resolve({ id: ID }) })],
    ["/admin/cases", async () => (await import("@/app/(admin)/admin/cases/page")).default({ searchParams: Promise.resolve({}) })],
  ];

  it.each(pages)("%s 404s a signed-out RSC request", async (_route, render) => {
    await expect(outcome(render)).resolves.toBe("404");
    expect(state.serviceClients).toBe(0);
  });

  it.each(pages)("%s sends a lapsed step-up to verify", async (_route, render) => {
    state.user = { id: "admin-1" };
    state.role = "viewer";
    state.totpAt = now() - 20 * 60;
    await expect(outcome(render)).resolves.toBe("redirect");
    expect(state.serviceClients).toBe(0);
  });

  it("the CSV export 404s a signed-out request and a lapsed step-up never reaches the data", async () => {
    const { GET } = await import("@/app/(admin)/admin/export/route");
    const response = await GET(new Request("https://drvn.test/admin/export?view=orders"));
    expect(response.status).toBe(404);
    state.user = { id: "admin-1" };
    state.role = "admin";
    state.totpAt = now() - 20 * 60;
    await expect(outcome(() => GET(new Request("https://drvn.test/admin/export?view=audit")))).resolves.toBe("redirect");
    expect(state.serviceClients).toBe(0);
  });
});

describe("no console route reads with the all-access key on its own", () => {
  const root = path.join(process.cwd(), "src/app/(admin)");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? files(full) : [full];
    });

  it("pages, layouts and routes take reads from the gated read client", () => {
    const offenders = files(root)
      .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file))
      // Server actions are mutations: each re-checks the full-admin role itself.
      .filter((file) => !/actions\.ts$/.test(file))
      .filter((file) => readFileSync(file, "utf8").includes("@/lib/supabase/admin"))
      .map((file) => path.relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });

  it("the read layer creates no all-access client except through the gate", () => {
    for (const file of ["src/lib/admin/queries.ts", "src/lib/admin/product-identity.ts"]) {
      expect(readFileSync(path.join(process.cwd(), file), "utf8")).not.toMatch(/createAdminClient\(/);
    }
  });
});
