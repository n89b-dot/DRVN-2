import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N11: the console's read gate. Every privileged read takes its all-access
 * client from adminReadClient(), which hands one out only to a current
 * member at AAL2 with a TOTP check in the last 15 minutes. N136: a promoted
 * member whose authenticator the operator hasn't confirmed is sent to set it
 * up, and never gets a client.
 */

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  role: null as string | null,
  enrolment: null as string | null,
  /** is_admin(): this session was raised to AAL2 with the confirmed factor. */
  bound: true,
  aal: "aal2" as string,
  totpAt: 0,
  path: "/admin/orders" as string | null,
  serviceClients: 0,
  rpcs: [] as string[],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.path ? { "x-drvn-path": state.path } : {}),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    state.serviceClients += 1;
    return { from: vi.fn(), rpc: vi.fn() };
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
    rpc: async (name: string) => {
      state.rpcs.push(name);
      const answers: Record<string, unknown> = { admin_role: state.role, admin_enrolment_state: state.enrolment, is_admin: state.bound };
      return { data: answers[name] ?? null, error: null };
    },
  }),
}));

import { adminReadClient, getAdminContext, requireAdminRead } from "./guard";

const now = () => Math.floor(Date.now() / 1000);

/** What Next's control flow threw: "404", or the redirect target. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "allowed";
  } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? error);
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return "404";
    if (digest.startsWith("NEXT_REDIRECT")) return `redirect ${digest.split(";")[2]}`;
    throw error;
  }
}

beforeEach(() => {
  Object.assign(state, {
    user: { id: "admin-1" },
    role: "admin",
    enrolment: "confirmed",
    bound: true,
    aal: "aal2",
    totpAt: now() - 60,
    path: "/admin/orders",
    serviceClients: 0,
    rpcs: [],
  });
});

describe("the console read gate (N11)", () => {
  it("hands a current, stepped-up admin the read client", async () => {
    await expect(outcome(() => adminReadClient())).resolves.toBe("allowed");
    expect(state.serviceClients).toBe(1);
    await expect(requireAdminRead()).resolves.toMatchObject({ userId: "admin-1", role: "admin" });
  });

  it("gives a read-only viewer reads too", async () => {
    state.role = "viewer";
    await expect(requireAdminRead()).resolves.toMatchObject({ role: "viewer" });
  });

  it("404s a signed-out request and never creates the all-access client", async () => {
    state.user = null;
    await expect(outcome(() => adminReadClient())).resolves.toBe("404");
    expect(state.serviceClients).toBe(0);
  });

  it("404s a signed-in member who isn't in the console, or was removed from it", async () => {
    state.role = null;
    state.enrolment = null;
    await expect(outcome(() => adminReadClient())).resolves.toBe("404");
    expect(state.serviceClients).toBe(0);
    expect(await getAdminContext()).toBeNull();
  });

  it("sends a lapsed step-up (TOTP over 15 minutes old) back to verify, with no client", async () => {
    state.totpAt = now() - 16 * 60;
    await expect(outcome(() => adminReadClient())).resolves.toBe(
      `redirect /admin-verify?next=${encodeURIComponent("/admin/orders")}`
    );
    expect(state.serviceClients).toBe(0);
  });

  it("sends a password-only (AAL1) session to verify, with no client", async () => {
    state.aal = "aal1";
    await expect(outcome(() => adminReadClient())).resolves.toMatch(/^redirect \/admin-verify/);
    expect(state.serviceClients).toBe(0);
  });
});

describe("the confirmed authenticator, not just any (OS-W14 follow-up)", () => {
  it("sends a fresh AAL2 session raised with another verified factor to verify, with no client", async () => {
    // Factors A (confirmed) and B on the account; this session used B.
    state.bound = false;
    await expect(outcome(() => adminReadClient())).resolves.toMatch(/^redirect \/admin-verify/);
    expect(state.serviceClients).toBe(0);
    expect(state.rpcs).toContain("is_admin");
  });

  it("lets the session raised with the confirmed factor through", async () => {
    await expect(outcome(() => adminReadClient())).resolves.toBe("allowed");
    expect(state.rpcs).toContain("is_admin");
  });
});

describe("unconfirmed authenticators (N136)", () => {
  it("sends a promoted member the operator hasn't confirmed to /admin-verify, never the console", async () => {
    state.role = null; // admin_role() is null until the operator confirms the factor
    state.enrolment = "pending";
    await expect(outcome(() => adminReadClient())).resolves.toMatch(/^redirect \/admin-verify/);
    expect(state.serviceClients).toBe(0);
    expect(state.rpcs).toContain("admin_enrolment_state");
  });

  it("doesn't ask about enrolment for a confirmed member", async () => {
    await requireAdminRead();
    expect(state.rpcs).not.toContain("admin_enrolment_state");
  });
});
