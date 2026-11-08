import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OS-W11 (Codex on #157): when a hold appears after cleanup, the worker lifts
 * the ban, but cleanup has already cleared the username. Sign-in and the
 * product layout sent "no username" to onboarding, which the member couldn't
 * finish while their deletion job existed, so the order link on the status
 * page led nowhere. The journey below signs in as that member and follows the
 * redirect into the product layout: it has to reach the order.
 */

const ORDER = "a1b2c3d4-0000-4000-8000-000000000001";

const db = vi.hoisted(() => ({
  username: null as string | null,
  deletion: null as { outcome: string; hold_order_id: string | null } | null,
  reads: [] as string[],
}));

const redirect = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  })
);

function client() {
  return {
    auth: {
      signInWithPassword: async () => ({ data: { user: { id: "member-1" } }, error: null }),
      getUser: async () => ({ data: { user: { id: "member-1", email: "member@drvn.test" } } }),
    },
    from: (table: string) => {
      db.reads.push(table);
      const row = () =>
        table === "profiles"
          ? { data: { username: db.username }, error: null }
          : table === "account_deletion_requests"
            ? { data: db.deletion, error: null }
            : { data: null, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => row(),
        maybeSingle: async () => row(),
      };
      return chain;
    },
  };
}

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "https://drvn.example" }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/age-confirmation-record", () => ({ hasAgeConfirmation: async () => true, recordAgeConfirmation: async () => true }));
vi.mock("@/lib/revalidate", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/site", () => ({ siteUrl: () => "https://drvn.example" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ insert: vi.fn() }) }) }));
vi.mock("@/lib/abuse-identity", () => ({ attributedNetworkIdentity: () => "network:abc" }));
vi.mock("@/lib/rate-limit", () => ({
  allowAction: async () => true,
  RATE_LIMITS: Object.fromEntries(
    ["signIn", "signInEmailCeiling", "signInNetwork", "passwordReset", "passwordResetEmailCeiling", "passwordResetNetwork", "signUp", "signUpEmailCeiling", "signUpNetwork"].map(
      (key) => [key, { action: key, limit: 10, windowSeconds: 900 }]
    )
  ),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client() }));
vi.mock("@/lib/supabase/page-context", () => ({
  getPageClient: async () => client(),
  getViewer: async () => ({ id: "member-1" }),
}));
// The shell around the page isn't under test.
vi.mock("@/components/ui", () => ({ AppShell: ({ children }: { children: ReactNode }) => <div data-shell="">{children}</div> }));
vi.mock("@/features/agent/agent-panel", () => ({ AgentPanel: () => null }));
vi.mock("@/lib/agent/beta", () => ({ agentTabOpen: async () => false, agentStepOpen: async () => false }));
vi.mock("@/features/commerce/live-messages", () => ({ LiveInbox: () => null }));
vi.mock("@/lib/cart", () => ({ cartCount: async () => 0 }));
vi.mock("@/lib/shell-counts", () => ({ loadShellCounts: () => Promise.resolve({}) }));

const { heldDeletionPath, landingWithoutUsername, loadHeldDeletion } = await import("./held-deletion");
const { login } = await import("@/app/(auth)/actions");
const { default: ProductLayout } = await import("@/app/(product)/layout");
const { default: OnboardingPage } = await import("@/app/(auth)/onboarding/page");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Where sign-in sends the member. */
async function signIn(next?: string): Promise<string> {
  try {
    await login({}, form({ email: "member@drvn.test", password: "pw", ...(next ? { next } : {}) }));
  } catch (error) {
    const match = /^redirect:(.*)$/.exec((error as Error).message);
    if (match) return match[1];
    throw error;
  }
  throw new Error("sign-in did not redirect");
}

/** The product layout for the page sign-in landed on: rendered, or where it redirected. */
async function openProductPage(): Promise<string> {
  try {
    return renderToStaticMarkup(await ProductLayout({ children: <main data-page="order" /> }));
  } catch (error) {
    const match = /^redirect:(.*)$/.exec((error as Error).message);
    if (match) return `redirect:${match[1]}`;
    throw error;
  }
}

beforeEach(() => {
  db.username = null;
  db.deletion = null;
  db.reads = [];
  redirect.mockClear();
});

describe("a held deletion after cleanup reaches its order (OS-W11, Codex on #157)", () => {
  it("signs in from the status page's link straight to the order, and the order page opens", async () => {
    db.deletion = { outcome: "temporary_financial_hold", hold_order_id: ORDER };
    const landed = await signIn(`/orders/${ORDER}`);
    expect(landed).toBe(`/orders/${ORDER}`);
    expect(await openProductPage()).toContain('data-page="order"');
  });

  it("signs in with no destination to the order holding the deletion", async () => {
    db.deletion = { outcome: "temporary_financial_hold", hold_order_id: ORDER };
    expect(await signIn()).toBe(`/orders/${ORDER}`);
  });

  it("sends a held member who opens onboarding to the order instead", async () => {
    db.deletion = { outcome: "temporary_financial_hold", hold_order_id: ORDER };
    await expect(OnboardingPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(`redirect:/orders/${ORDER}`);
  });

  it("still sends an account with no handle and no held deletion to onboarding", async () => {
    expect(await signIn(`/orders/${ORDER}`)).toBe(`/onboarding?next=${encodeURIComponent(`/orders/${ORDER}`)}`);
    expect(await openProductPage()).toBe("redirect:/onboarding");
  });

  it("doesn't treat a deletion being cleaned up as held", async () => {
    db.deletion = { outcome: "cleanup_pending", hold_order_id: null };
    expect(await openProductPage()).toBe("redirect:/onboarding");
  });

  it("never reads the deletion case for a member with a handle", async () => {
    db.username = "kaito";
    expect(await openProductPage()).toContain('data-page="order"');
    expect(db.reads).not.toContain("account_deletion_requests");
  });
});

describe("the landing rule itself", () => {
  it("keeps a validated destination, and refuses an outside one", () => {
    const held = { orderId: ORDER };
    expect(landingWithoutUsername(held, "/orders")).toBe("/orders");
    expect(landingWithoutUsername(held, "https://evil.example/x")).toBe(`/orders/${ORDER}`);
    expect(landingWithoutUsername(null, "/orders")).toBe("/onboarding?next=%2Forders");
  });

  it("falls back to the member's orders when the hold names no order", async () => {
    expect(heldDeletionPath({ orderId: null })).toBe("/orders");
    db.deletion = { outcome: "temporary_financial_hold", hold_order_id: null };
    await expect(loadHeldDeletion(client() as never, "member-1")).resolves.toEqual({ orderId: null });
  });
});
