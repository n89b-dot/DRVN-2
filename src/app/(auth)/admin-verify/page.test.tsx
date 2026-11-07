import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * N136: a promoted member's authenticator is first-come no longer. Until the
 * operator confirms it, /admin-verify offers that member enrolment and then
 * the factor's reference to read to the operator — never the console — and
 * everyone else still gets the console's 404.
 */

const state = vi.hoisted(() => ({
  role: null as string | null,
  enrolment: null as string | null,
  factors: [] as { id: string; status: string; created_at: string }[],
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "member-1" } } }),
      mfa: { listFactors: async () => ({ data: { totp: state.factors, all: state.factors }, error: null }) },
    },
    rpc: async (name: string) => ({ data: name === "admin_role" ? state.role : name === "admin_enrolment_state" ? state.enrolment : null, error: null }),
  }),
}));

const { default: AdminVerifyPage } = await import("./page");

const render = async () => renderToStaticMarkup(await AdminVerifyPage({ searchParams: Promise.resolve({ next: "/admin/users" }) }));

beforeEach(() => {
  state.role = null;
  state.enrolment = null;
  state.factors = [];
});

describe("/admin-verify (N136)", () => {
  it("404s someone who isn't a console member", async () => {
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("offers a promoted, unconfirmed member enrolment and says the operator must confirm it", async () => {
    state.enrolment = "pending";
    const html = await render();
    expect(html).toContain("Set up authenticator");
    expect(html).toContain("operator who added you has confirmed this authenticator");
    expect(html).not.toContain("Verification lasts 15 minutes");
  });

  it("shows a pending member with a verified factor its reference, not a way in", async () => {
    state.enrolment = "pending";
    state.factors = [{ id: "a1b2c3d4-0000-4000-8000-000000000001", status: "verified", created_at: "2026-11-07T10:00:00Z" }];
    const html = await render();
    expect(html).toContain("a1b2c3d4-0000-4000-8000-000000000001");
    expect(html).toContain("someone else has your password");
    expect(html).not.toContain("Authenticator code");
    expect(html).not.toContain("Set up authenticator");
  });

  it("asks a confirmed member for their code", async () => {
    state.role = "admin";
    state.factors = [{ id: "f-1", status: "verified", created_at: "2026-11-07T10:00:00Z" }];
    const html = await render();
    expect(html).toContain("Authenticator code");
    expect(html).toContain("Verification lasts 15 minutes");
    expect(html).not.toContain("Read them this reference");
  });
});
